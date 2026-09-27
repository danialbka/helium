import { writeSync } from 'node:fs';

// Upstream may print a connection URL containing the extension token. Buffer
// until exit so even split writes and immediate process.exit() stay redacted.
export function protectOutput(token, maxBytes = 32 * 1024 * 1024) {
  const streams = [{ stream: process.stdout, fd: 1 }, { stream: process.stderr, fd: 2 }];
  let bytes = 0;
  for (const item of streams) {
    // Exit listeners cannot await drain; Node pipes must block while flushing.
    item.stream._handle?.setBlocking?.(true);
    item.chunks = [];
    item.stream.write = (chunk, encoding, callback) => {
      if (typeof encoding === 'function') callback = encoding;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        item.chunks.push(Buffer.from('\nHelium CLI output exceeded 32 MiB. Request a smaller result.\n'));
        process.exit(1);
      }
      item.chunks.push(buffer);
      if (callback) queueMicrotask(callback);
      return true;
    };
  }
  process.once('exit', () => {
    for (const { chunks, fd } of streams) {
      let text = Buffer.concat(chunks).toString('utf8');
      if (token) {
        for (const secret of new Set([token, encodeURIComponent(token)]))
          text = text.replaceAll(secret, '[redacted]');
      }
      if (text) {
        try {
          const buffer = Buffer.from(text);
          let offset = 0;
          while (offset < buffer.length) offset += writeSync(fd, buffer, offset);
        } catch { /* Consumer may have closed its pipe. */ }
      }
    }
  });
}
