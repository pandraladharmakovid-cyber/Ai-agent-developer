'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const multer = require('multer');
const AdmZip = require('adm-zip');

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(process.cwd(), '.env'));
  } catch {
    // Environment variables may already be supplied by the host.
  }
}

if (!process.env.AGENT_WORKSPACE) {
  process.env.AGENT_WORKSPACE = path.join(
    process.cwd(),
    '.agent-workspace'
  );
}

require('tsx/cjs');

const { runAgent } = require('./agent.ts');
const { executeTool } = require('./tools.ts');

const app = express();

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC_DIR = __dirname;
const INDEX_FILE = path.join(__dirname, 'index.html');

/*
|--------------------------------------------------------------------------
| Workspace configuration
|--------------------------------------------------------------------------
|
| The agent works inside one controlled workspace for the current server
| instance. Later, authentication/database will give every user their
| own persistent workspace.
|
*/

const WORKSPACE_DIR = path.resolve(
  process.env.AGENT_WORKSPACE ||
    path.join(process.cwd(), '.agent-workspace')
);

const UPLOAD_DIR = path.join(os.tmpdir(), 'ai-developer-agent-uploads');

const MAX_FILE_SIZE = 100 * 1024 * 1024;       // 100 MB per file
const MAX_PROJECT_SIZE = 500 * 1024 * 1024;    // 500 MB total
const MAX_ZIP_SIZE = 250 * 1024 * 1024;        // 250 MB ZIP
const MAX_FILES = 2000;
const MAX_ZIP_ENTRIES = 5000;
const MAX_PASTE_SIZE = 10 * 1024 * 1024;       // 10 MB

/*
|--------------------------------------------------------------------------
| Startup directories
|--------------------------------------------------------------------------
*/

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/*
|--------------------------------------------------------------------------
| Basic security
|--------------------------------------------------------------------------
*/

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );

  next();
});

/*
|--------------------------------------------------------------------------
| Request parsing
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: '1mb',
    strict: true
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: '1mb'
  })
);

/*
|--------------------------------------------------------------------------
| Request logging
|--------------------------------------------------------------------------
*/

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startedAt;

    console.log(
      `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });

  next();
});

/*
|--------------------------------------------------------------------------
| Static files
|--------------------------------------------------------------------------
*/

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    fallthrough: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
  })
);

/*
|--------------------------------------------------------------------------
| Upload middleware
|--------------------------------------------------------------------------
|
| Files are initially stored in a temporary directory.
| They are moved into the controlled agent workspace only after validation.
|
*/

const upload = multer({
   preservePath: true,
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      callback(null, UPLOAD_DIR);
    },

    filename: (req, file, callback) => {
      const id = crypto.randomBytes(16).toString('hex');

      callback(
        null,
        `${Date.now()}-${id}.upload`
      );
    }
  }),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    parts: MAX_FILES + 20
  }
});

/*
|--------------------------------------------------------------------------
| Utility helpers
|--------------------------------------------------------------------------
*/

function sendError(res, status, message, details = undefined) {
  const payload = {
    ok: false,
    error: message
  };

  if (
    process.env.NODE_ENV !== 'production' &&
    details
  ) {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

function cleanName(value) {
  return String(value || '')
    .replace(/\0/g, '')
    .trim();
}

function normalizeRelativePath(input) {
  let value = cleanName(input);

  value = value.replace(/\\/g, '/');

  while (value.startsWith('/')) {
    value = value.slice(1);
  }

  value = path.posix.normalize(value);

  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.startsWith('../') ||
    value.includes('/../') ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error('Unsafe project path.');
  }

  if (value.length > 500) {
    throw new Error('Project file path is too long.');
  }

  return value;
}

function resolveWorkspacePath(relativePath) {
  const safePath = normalizeRelativePath(relativePath);

  const resolved = path.resolve(
    WORKSPACE_DIR,
    safePath
  );

  const workspacePrefix = WORKSPACE_DIR.endsWith(path.sep)
    ? WORKSPACE_DIR
    : WORKSPACE_DIR + path.sep;

  if (
    resolved !== WORKSPACE_DIR &&
    !resolved.startsWith(workspacePrefix)
  ) {
    throw new Error('Path escapes the agent workspace.');
  }

  return resolved;
}

async function removeContents(directory) {
  await fsp.mkdir(directory, { recursive: true });

  const entries = await fsp.readdir(directory);

  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry);

      await fsp.rm(target, {
        recursive: true,
        force: true
      });
    })
  );
}

async function resetWorkspace() {
  await removeContents(WORKSPACE_DIR);
}

async function countWorkspaceFiles() {
  let count = 0;

  async function walk(directory) {
    const entries = await fsp.readdir(
      directory,
      { withFileTypes: true }
    );

    for (const entry of entries) {
      const target = path.join(
        directory,
        entry.name
      );

      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile()) {
        count += 1;

        if (count > MAX_FILES) {
          throw new Error(
            `Project exceeds the maximum of ${MAX_FILES} files.`
          );
        }
      }
    }
  }

  await walk(WORKSPACE_DIR);

  return count;
}

async function calculateWorkspaceSize() {
  let total = 0;

  async function walk(directory) {
    const entries = await fsp.readdir(
      directory,
      { withFileTypes: true }
    );

    for (const entry of entries) {
      const target = path.join(
        directory,
        entry.name
      );

      if (entry.isDirectory()) {
        await walk(target);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(target);

        total += stat.size;

        if (total > MAX_PROJECT_SIZE) {
          throw new Error(
            'Project exceeds the 500 MB workspace limit.'
          );
        }
      }
    }
  }

  await walk(WORKSPACE_DIR);

  return total;
}

async function removeTemporaryFile(file) {
  if (!file || !file.path) {
    return;
  }

  try {
    await fsp.rm(file.path, {
      force: true
    });
  } catch {
    // Best effort cleanup.
  }
}

async function removeTemporaryFiles(files) {
  if (!Array.isArray(files)) {
    return;
  }

  await Promise.all(
    files.map(removeTemporaryFile)
  );
}

function isZipFile(file) {
  const originalName = cleanName(
    file?.originalname
  ).toLowerCase();

  return (
    originalName.endsWith('.zip') ||
    file?.mimetype === 'application/zip' ||
    file?.mimetype === 'application/x-zip-compressed'
  );
}

/*
|--------------------------------------------------------------------------
| ZIP extraction
|--------------------------------------------------------------------------
|
| Every archive entry is validated before it is written.
| This prevents ZIP-slip/path-traversal attacks.
|
*/

async function extractZipSafely(zipFile) {
  if (!zipFile) {
    throw new Error('ZIP file is required.');
  }

  if (!isZipFile(zipFile)) {
    throw new Error('Only .zip project files are supported.');
  }

  if (zipFile.size > MAX_ZIP_SIZE) {
    throw new Error(
      'ZIP file is too large. Maximum size is 250 MB.'
    );
  }

  const zip = new AdmZip(zipFile.path);
  const entries = zip.getEntries();

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `ZIP contains too many entries. Maximum is ${MAX_ZIP_ENTRIES}.`
    );
  }

  let extractedFiles = 0;
  let extractedBytes = 0;

  for (const entry of entries) {
    const entryName = entry.entryName || '';

    if (entry.isDirectory) {
      continue;
    }

    const relativePath = normalizeRelativePath(
      entryName
    );

    const destination = resolveWorkspacePath(
      relativePath
    );

    const data = entry.getData();

    extractedBytes += data.length;

    if (extractedBytes > MAX_PROJECT_SIZE) {
      throw new Error(
        'Extracted project exceeds the 500 MB workspace limit.'
      );
    }

    extractedFiles += 1;

    if (extractedFiles > MAX_FILES) {
      throw new Error(
        `Project exceeds the maximum of ${MAX_FILES} files.`
      );
    }

    await fsp.mkdir(
      path.dirname(destination),
      { recursive: true }
    );

    await fsp.writeFile(
      destination,
      data
    );
  }

  return {
    fileCount: extractedFiles,
    totalBytes: extractedBytes
  };
}

/*
|--------------------------------------------------------------------------
| Project source information
|--------------------------------------------------------------------------
*/

let currentWorkspace = {
  ready: false,
  sourceType: null,
  sourceName: null,
  fileCount: 0,
  totalBytes: 0,
  updatedAt: null
};

function markWorkspaceReady({
  sourceType,
  sourceName,
  fileCount,
  totalBytes
}) {
  currentWorkspace = {
    ready: true,
    sourceType,
    sourceName,
    fileCount,
    totalBytes,
    updatedAt: new Date().toISOString()
  };
}

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'ai-developer-agent',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

/*
|--------------------------------------------------------------------------
| API status
|--------------------------------------------------------------------------
*/

app.get('/api/status', (req, res) => {
  res.status(200).json({
    ok: true,

    agent: {
      name: 'AI Developer Agent',
      level: 2,
      status: 'ready'
    },

    workspace: {
      ready: currentWorkspace.ready,
      sourceType: currentWorkspace.sourceType,
      sourceName: currentWorkspace.sourceName,
      fileCount: currentWorkspace.fileCount,
      totalBytes: currentWorkspace.totalBytes,
      updatedAt: currentWorkspace.updatedAt
    },

    capabilities: [
      'repository-analysis',
      'planning',
      'tool-execution',
      'code-editing',
      'research',
      'testing',
      'verification'
    ]
  });
});

/*
|--------------------------------------------------------------------------
| Workspace status
|--------------------------------------------------------------------------
*/

app.get('/api/workspace', (req, res) => {
  res.status(200).json({
    ok: true,
    workspace: {
      path: WORKSPACE_DIR,
      ready: currentWorkspace.ready,
      sourceType: currentWorkspace.sourceType,
      sourceName: currentWorkspace.sourceName,
      fileCount: currentWorkspace.fileCount,
      totalBytes: currentWorkspace.totalBytes,
      updatedAt: currentWorkspace.updatedAt
    }
  });
});

/*
|--------------------------------------------------------------------------
| Upload ZIP project
|--------------------------------------------------------------------------
*/

app.post(
  '/api/workspace/upload',
  upload.single('project'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return sendError(
          res,
          400,
          'Project ZIP file is required.'
        );
      }

      if (!isZipFile(req.file)) {
        await removeTemporaryFile(req.file);

        return sendError(
          res,
          400,
          'Only ZIP project files are supported.'
        );
      }

      await resetWorkspace();

      const extracted = await extractZipSafely(
        req.file
      );

      const totalBytes = await calculateWorkspaceSize();

      markWorkspaceReady({
        sourceType: 'zip',
        sourceName: cleanName(
          req.file.originalname
        ),
        fileCount: extracted.fileCount,
        totalBytes
      });

      console.log(
        `[WORKSPACE] ZIP loaded: ${req.file.originalname} ` +
        `(${extracted.fileCount} files)`
      );

      return res.status(201).json({
        ok: true,
        name: cleanName(req.file.originalname),
        sourceType: 'zip',
        fileCount: extracted.fileCount,
        totalBytes,
        workspaceReady: true
      });
    } catch (error) {
      return next(error);
    } finally {
      await removeTemporaryFile(req.file);
    }
  }
);

/*
|--------------------------------------------------------------------------
| Upload files / project folder
|--------------------------------------------------------------------------
*/

app.post(
  '/api/workspace/files',
  upload.array('files', MAX_FILES),
  async (req, res, next) => {
    try {
      const files = Array.isArray(req.files)
        ? req.files
        : [];

      if (!files.length) {
        return sendError(
          res,
          400,
          'At least one project file is required.'
        );
      }

      await resetWorkspace();

      let totalBytes = 0;

      for (const file of files) {
        const originalPath = cleanName(
          file.originalname
        );

        const relativePath =
          normalizeRelativePath(originalPath);

        const destination =
          resolveWorkspacePath(relativePath);

        totalBytes += file.size;

        if (totalBytes > MAX_PROJECT_SIZE) {
          throw new Error(
            'Project exceeds the 500 MB workspace limit.'
          );
        }

        await fsp.mkdir(
          path.dirname(destination),
          {
            recursive: true
          }
        );

        await fsp.copyFile(
          file.path,
          destination
        );
      }

      const fileCount =
        await countWorkspaceFiles();

      markWorkspaceReady({
        sourceType: 'files',
        sourceName: 'Uploaded project',
        fileCount,
        totalBytes
      });

      console.log(
        `[WORKSPACE] Files loaded: ${fileCount} files`
      );

      return res.status(201).json({
        ok: true,
        name: 'Uploaded project',
        sourceType: 'files',
        fileCount,
        totalBytes,
        workspaceReady: true
      });
    } catch (error) {
      return next(error);
    } finally {
      await removeTemporaryFiles(req.files);
    }
  }
);

/*
|--------------------------------------------------------------------------
| Paste a file
|--------------------------------------------------------------------------
*/

app.post(
  '/api/workspace/paste',
  upload.none(),
  async (req, res, next) => {
    try {
      const filename = cleanName(
        req.body?.filename
      );

      const content =
        typeof req.body?.content === 'string'
          ? req.body.content
          : '';

      if (!filename) {
        return sendError(
          res,
          400,
          'Filename is required.'
        );
      }

      if (!content.trim()) {
        return sendError(
          res,
          400,
          'File content cannot be empty.'
        );
      }

      const contentBytes =
        Buffer.byteLength(
          content,
          'utf8'
        );

      if (contentBytes > MAX_PASTE_SIZE) {
        return sendError(
          res,
          413,
          'Pasted file is too large. Maximum size is 10 MB.'
        );
      }

      const replaceWorkspace =
        String(req.body?.replaceWorkspace).toLowerCase() ===
        'true';

      if (replaceWorkspace) {
        await resetWorkspace();
      }

      const destination =
        resolveWorkspacePath(filename);

      await fsp.mkdir(
        path.dirname(destination),
        {
          recursive: true
        }
      );

      await fsp.writeFile(
        destination,
        content,
        'utf8'
      );

      const fileCount =
        await countWorkspaceFiles();

      const totalBytes =
        await calculateWorkspaceSize();

      markWorkspaceReady({
        sourceType: 'paste',
        sourceName: filename,
        fileCount,
        totalBytes
      });

      console.log(
        `[WORKSPACE] Pasted file added: ${filename}`
      );

      return res.status(201).json({
        ok: true,
        name: filename,
        sourceType: 'paste',
        fileCount,
        totalBytes,
        workspaceReady: true
      });
    } catch (error) {
      return next(error);
    }
  }
);

/*
|--------------------------------------------------------------------------
| GitHub repository import
|--------------------------------------------------------------------------
|
| The GitHub token is read ONLY from the server environment.
| It is never sent to the browser.
|
*/

function parseGitHubUrl(repositoryUrl) {
  let parsed;

  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw new Error(
      'Invalid GitHub repository URL.'
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'github.com'
  ) {
    throw new Error(
      'Only https://github.com repository URLs are supported.'
    );
  }

  const parts = parsed.pathname
    .split('/')
    .filter(Boolean);

  if (parts.length < 2) {
    throw new Error(
      'GitHub URL must contain an owner and repository.'
    );
  }

  const owner = parts[0];
  const repo = parts[1]
    .replace(/\.git$/i, '');

  if (
    !/^[a-zA-Z0-9._-]+$/.test(owner) ||
    !/^[a-zA-Z0-9._-]+$/.test(repo)
  ) {
    throw new Error(
      'Invalid GitHub owner or repository name.'
    );
  }

  return {
    owner,
    repo
  };
}

async function importGitHubRepository(repositoryUrl) {
  const {
    owner,
    repo
  } = parseGitHubUrl(repositoryUrl);

  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_PAT ||
    '';

  const endpoint =
    `https://api.github.com/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/tarball`;

  const headers = {
    'User-Agent':
      'AI-Developer-Agent/2.0',
    'Accept':
      'application/vnd.github+json'
  };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(endpoint, {
      method: 'GET',
      headers,
      redirect: 'follow'
    });

  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403
    ) {
      throw new Error(
        'GitHub rejected the repository request. Check GITHUB_TOKEN permissions.'
      );
    }

    if (response.status === 404) {
      throw new Error(
        'GitHub repository was not found or is not accessible.'
      );
    }

    throw new Error(
      `GitHub repository download failed (${response.status}).`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  const archivePath = path.join(
    UPLOAD_DIR,
    `${Date.now()}-${crypto
      .randomBytes(8)
      .toString('hex')}.tar.gz`
  );

  await fsp.writeFile(
    archivePath,
    Buffer.from(arrayBuffer)
  );

  try {
    const archiveSize =
      (await fsp.stat(archivePath)).size;

    if (archiveSize > MAX_ZIP_SIZE) {
      throw new Error(
        'GitHub repository archive is too large.'
      );
    }

    await resetWorkspace();

    const extractionDir =
      path.join(
        UPLOAD_DIR,
        `github-${crypto
          .randomBytes(8)
          .toString('hex')}`
      );

    await fsp.mkdir(
      extractionDir,
      {
        recursive: true
      }
    );

    try {
      await execFileAsync(
        'tar',
        [
          '-xzf',
          archivePath,
          '-C',
          extractionDir
        ],
        {
          maxBuffer: 10 * 1024 * 1024
        }
      );

      const extractedEntries =
        await fsp.readdir(
          extractionDir,
          {
            withFileTypes: true
          }
        );

      const rootDirectory =
        extractedEntries.find(
          (entry) => entry.isDirectory()
        );

      if (!rootDirectory) {
        throw new Error(
          'GitHub repository archive did not contain a project directory.'
        );
      }

      const sourceRoot =
        path.join(
          extractionDir,
          rootDirectory.name
        );

      async function copyDirectory(
        source,
        destination
      ) {
        const entries =
          await fsp.readdir(
            source,
            {
              withFileTypes: true
            }
          );

        for (const entry of entries) {
          const relative =
            path.relative(
              sourceRoot,
              path.join(
                source,
                entry.name
              )
            );

          const safeRelative =
            normalizeRelativePath(
              relative
            );

          const target =
            resolveWorkspacePath(
              safeRelative
            );

          const sourcePath =
            path.join(
              source,
              entry.name
            );

          if (entry.isDirectory()) {
            await fsp.mkdir(
              target,
              {
                recursive: true
              }
            );

            await copyDirectory(
              sourcePath,
              target
            );
          } else if (entry.isFile()) {
            await fsp.mkdir(
              path.dirname(target),
              {
                recursive: true
              }
            );

            await fsp.copyFile(
              sourcePath,
              target
            );
          }
        }
      }

      await copyDirectory(
        sourceRoot,
        WORKSPACE_DIR
      );

      const fileCount =
        await countWorkspaceFiles();

      const totalBytes =
        await calculateWorkspaceSize();

      return {
        owner,
        repo,
        fileCount,
        totalBytes
      };
    } finally {
      await fsp.rm(
        extractionDir,
        {
          recursive: true,
          force: true
        }
      );
    }
  } finally {
    await fsp.rm(
      archivePath,
      {
        force: true
      }
    );
  }
}

app.post(
  '/api/workspace/github',
  upload.none(),
  async (req, res, next) => {
    try {
      const repositoryUrl =
        cleanName(req.body?.url);

      if (!repositoryUrl) {
        return sendError(
          res,
          400,
          'GitHub repository URL is required.'
        );
      }

      const imported =
        await importGitHubRepository(
          repositoryUrl
        );

      markWorkspaceReady({
        sourceType: 'github',
        sourceName: repositoryUrl,
        fileCount: imported.fileCount,
        totalBytes: imported.totalBytes
      });

      console.log(
        `[WORKSPACE] GitHub repository loaded: ${repositoryUrl}`
      );

      return res.status(201).json({
        ok: true,
        name: repositoryUrl,
        sourceType: 'github',
        fileCount: imported.fileCount,
        totalBytes: imported.totalBytes,
        workspaceReady: true
      });
    } catch (error) {
      return next(error);
    }
  }
);

/*
|--------------------------------------------------------------------------
| Agent run endpoint
|--------------------------------------------------------------------------
|
| This establishes the real contract between the UI and agent layer.
| The agent execution engine will be connected through agent.ts after
| the workspace/tool layer is complete.
|
*/

app.post('/api/agent/run', async (req, res, next) => {
  try {
    const {
      task,
      sourceType,
      sourceName
    } = req.body || {};

    if (typeof task !== 'string') {
      return sendError(
        res,
        400,
        'Task must be a string.'
      );
    }

    const cleanedTask = task.trim();

    if (!cleanedTask) {
      return sendError(
        res,
        400,
        'Task cannot be empty.'
      );
    }

    if (cleanedTask.length > 20000) {
      return sendError(
        res,
        413,
        'Task is too large. Maximum length is 20,000 characters.'
      );
    }

    if (!currentWorkspace.ready) {
      return sendError(
        res,
        400,
        'No project is loaded. Upload or provide a project first.'
      );
    }

    const runId =
      `run_${Date.now()}_` +
      crypto.randomBytes(6).toString('hex');

    console.log(
      `[AGENT] Run ${runId} created`
    );

    console.log(
      `[AGENT] Source: ${sourceType || currentWorkspace.sourceType}`
    );

    console.log(
      `[AGENT] Workspace files: ${currentWorkspace.fileCount}`
    );

    console.log(
      `[AGENT] Task: ${cleanedTask.slice(0, 200)}`
    );

    const result =
      await runAgent(
        {
          id: runId,
          description: cleanedTask,
          repository:
            sourceType === 'github'
              ? sourceName
              : undefined,
          workingDirectory: WORKSPACE_DIR,
        },
        executeTool
      );

    return res.status(202).json({
      ok: true,
      accepted: true,
      result,

      run: {
        id: runId,
        status: result.status,
        stage:
          result.events[result.events.length - 1]?.stage ||
          'failed',
        task: cleanedTask,
        sourceType:
          sourceType ||
          currentWorkspace.sourceType,
        sourceName:
          sourceName ||
          currentWorkspace.sourceName,
        workspaceFiles:
          currentWorkspace.fileCount
      },

      message:
        result.summary
    });
  } catch (error) {
    return next(error);
  }
});

/*
|--------------------------------------------------------------------------
| Existing task endpoint
|--------------------------------------------------------------------------
*/

app.post('/api/tasks', (req, res) => {
  const {
    task
  } = req.body || {};

  if (typeof task !== 'string') {
    return sendError(
      res,
      400,
      'Task must be a string.'
    );
  }

  const cleanedTask =
    task.trim();

  if (!cleanedTask) {
    return sendError(
      res,
      400,
      'Task cannot be empty.'
    );
  }

  if (cleanedTask.length > 20000) {
    return sendError(
      res,
      413,
      'Task is too large. Maximum length is 20,000 characters.'
    );
  }

  console.log(
    `[AGENT] Task received: ${cleanedTask.slice(0, 200)}...`
  );

  return res.status(202).json({
    ok: true,
    accepted: true,

    task: {
      id:
        `task_${Date.now()}_` +
        Math.random()
          .toString(36)
          .slice(2, 10),

      status: 'queued',

      message:
        'Task accepted.'
    }
  });
});

/*
|--------------------------------------------------------------------------
| Root page
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.sendFile(INDEX_FILE);
});

/*
|--------------------------------------------------------------------------
| API 404 handler
|--------------------------------------------------------------------------
*/

app.use('/api', (req, res) => {
  return sendError(
    res,
    404,
    'API endpoint not found.',
  );
});

/*
|--------------------------------------------------------------------------
| Page 404 handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).send(
    'Page not found.'
  );
});

/*
|--------------------------------------------------------------------------
| Multer / body-parser errors
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  if (
    err instanceof multer.MulterError
  ) {
    if (
      err.code ===
      'LIMIT_FILE_SIZE'
    ) {
      return sendError(
        res,
        413,
        'Uploaded file is too large. Maximum size is 100 MB per file.'
      );
    }

    if (
      err.code ===
      'LIMIT_FILE_COUNT'
    ) {
      return sendError(
        res,
        413,
        `Too many files. Maximum is ${MAX_FILES}.`
      );
    }

    if (
      err.code ===
      'LIMIT_PART_COUNT'
    ) {
      return sendError(
        res,
        413,
        'Too many multipart form parts.'
      );
    }

    return sendError(
      res,
      400,
      `Upload error: ${err.message}`
    );
  }

  if (
    err instanceof SyntaxError &&
    err.status === 400 &&
    'body' in err
  ) {
    return sendError(
      res,
      400,
      'Invalid JSON request body.'
    );
  }

  if (
    err &&
    err.type === 'entity.too.large'
  ) {
    return sendError(
      res,
      413,
      'Request body is too large.'
    );
  }

  next(err);
});

/*
|--------------------------------------------------------------------------
| Global error handler
|--------------------------------------------------------------------------
*/

app.use(
  (err, req, res, next) => {
    console.error(
      '[SERVER ERROR]',
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    return res.status(500).json({
      ok: false,

      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error.'
          : err.message ||
            'Internal server error.'
    });
  }
);

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

const server = require.main === module
  ? app.listen(
      PORT,
      HOST,
      () => {
        console.log('');
        console.log(
          '=============================================='
        );
        console.log(
          '      AI DEVELOPER AGENT — LEVEL 2'
        );
        console.log(
          '=============================================='
        );
        console.log(
          `Server:  http://${HOST}:${PORT}`
        );
        console.log(
          `Port:    ${PORT}`
        );
        console.log(
          `Mode:    ${process.env.NODE_ENV || 'development'}`
        );
        console.log(
          `Workspace: ${WORKSPACE_DIR}`
        );
        console.log(
          'Status:  READY'
        );
        console.log(
          '=============================================='
        );
        console.log('');
      }
    )
  : null;

/*
|--------------------------------------------------------------------------
| Graceful shutdown
|--------------------------------------------------------------------------
*/

function shutdown(signal) {
  if (!server) {
    return;
  }

  console.log(
    `\n[SERVER] ${signal} received. Shutting down...`
  );

  server.close(() => {
    console.log(
      '[SERVER] HTTP server closed.'
    );

    process.exit(0);
  });

  setTimeout(() => {
    console.error(
      '[SERVER] Forced shutdown.'
    );

    process.exit(1);
  }, 10000).unref();
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);

module.exports = app;