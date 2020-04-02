import chalk from 'chalk';
import denodeify from 'denodeify';
import _read from 'read';
import yauzl from 'yauzl';
import { Manifest } from './manifest';

const readDenodeify = denodeify<_read.Options, string>(_read);
export function read(
  prompt: string,
  options: _read.Options = {}
): Promise<string> {
  if (process.env['VSCE_TESTS'] || !process.stdout.isTTY) {
    return Promise.resolve('y');
  }

  return readDenodeify({ prompt, ...options });
}

export function normalize(path: string): string {
  return path.replace(/\\/g, '/');
}

async function chain2<A, B>(
  a: A,
  b: B[],
  fn: (a: A, b: B) => Promise<A>,
  index = 0
): Promise<A> {
  if (index >= b.length) {
    return Promise.resolve(a);
  }

  return fn(a, b[index]).then(a => chain2(a, b, fn, index + 1));
}

export function chain<T, P>(
  initial: T,
  processors: P[],
  process: (a: T, b: P) => Promise<T>
): Promise<T> {
  return chain2(initial, processors, process);
}

export function flatten<T>(arr: T[][]): T[] {
  return [].concat.apply([], arr as any) as T[];
}

const CANCELLED_ERROR = 'Cancelled';

export function isCancelledError(error: any) {
  return error === CANCELLED_ERROR;
}

export class CancellationToken {
  private listeners: Function[] = [];
  private _cancelled = false;
  get isCancelled(): boolean {
    return this._cancelled;
  }

  subscribe(fn: Function): Function {
    this.listeners.push(fn);

    return () => {
      const index = this.listeners.indexOf(fn);

      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  cancel(): void {
    const emit = !this._cancelled;
    this._cancelled = true;

    if (emit) {
      this.listeners.forEach(l => l(CANCELLED_ERROR));
      this.listeners = [];
    }
  }
}

export async function sequence(
  promiseFactories: Array<{ (): Promise<any> }>
): Promise<void> {
  for (const factory of promiseFactories) {
    await factory();
  }
}

export function readManifestFromPackage(
  packagePath: string
): Promise<Manifest> {
  return new Promise<Manifest>((c, e) => {
    yauzl.open(packagePath, (err, zipfile) => {
      if (err) {
        return e(err);
      }
      if (!zipfile) {
        return e(zipfile);
      }

      const onEnd = () => e(new Error('Manifest not found'));
      zipfile.once('end', onEnd);

      zipfile.on('entry', entry => {
        if (!/^extension\/package\.json$/i.test(entry.fileName)) {
          return;
        }

        zipfile.removeListener('end', onEnd);

        zipfile.openReadStream(entry, (err, stream) => {
          if (err) {
            return e(err);
          }
          if (!stream) {
            return e(stream);
          }

          const buffers: Buffer[] = [];
          stream.on('data', buffer => buffers.push(buffer as Buffer));
          stream.once('error', e);
          stream.once('end', () => {
            try {
              c(JSON.parse(Buffer.concat(buffers).toString('utf8')));
            } catch (err) {
              e(err);
            }
          });
        });
      });
    });
  });
}

enum LogMessageType {
  DONE,
  INFO,
  WARNING,
  ERROR,
}

const LOG_PREFIX = {
  [LogMessageType.DONE]: chalk.bgGreen.black(' DONE '),
  [LogMessageType.INFO]: chalk.bgBlueBright.black(' INFO '),
  [LogMessageType.WARNING]: chalk.bgYellow.black(' WARNING '),
  [LogMessageType.ERROR]: chalk.bgRed.black(' ERROR '),
};

function _log(type: LogMessageType, msg: any, ...args: any[]): void {
  args = [LOG_PREFIX[type], msg, ...args];

  if (type === LogMessageType.WARNING) {
    console.warn(...args);
  } else if (type === LogMessageType.ERROR) {
    console.error(...args);
  } else {
    console.log(...args);
  }
}

export interface LogFn {
  (msg: any, ...args: any[]): void;
}

export const log = {
  done: _log.bind(null, LogMessageType.DONE) as LogFn,
  info: _log.bind(null, LogMessageType.INFO) as LogFn,
  warn: _log.bind(null, LogMessageType.WARNING) as LogFn,
  error: _log.bind(null, LogMessageType.ERROR) as LogFn,
};
