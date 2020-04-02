import program from 'commander';
import didYouMean from 'didyoumean';
import semver from 'semver';
import { isatty } from 'tty';
import { getLatestVersion } from './npm';
import { ls, packageCommand } from './package';
import { listRemote, publish, show, unpublish } from './remote';
import { CancellationToken, log } from './util';

const pkg = require('../package.json');

function fatal(message: any, ...args: any[]): void {
  if (message instanceof Error) {
    message = message.message;

    if (/^cancell?ed$/i.test(message)) {
      return;
    }
  }

  log.error(message, ...args);

  if (/Unauthorized\(401\)/.test(message)) {
    log.error(`Be sure to use a Personal Access Token which has access to **all accessible accounts**.
See https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions for more information.`);
  }

  process.exit(1);
}

function main(task: Promise<any>): void {
  let latestVersion: string;

  const token = new CancellationToken();

  if (isatty(1)) {
    getLatestVersion(pkg.name, token)
      .then(version => (latestVersion = version))
      .catch(_ => {
        /* noop */
      });
  }

  task.catch(fatal).then(() => {
    if (latestVersion && semver.gt(latestVersion, pkg.version)) {
      log.info(
        `\nThe latest version of ${pkg.name} is ${latestVersion} and you have ${pkg.version}.\nUpdate it now: npm install -g ${pkg.name}`
      );
    } else {
      token.cancel();
    }
  });
}

module.exports = (argv: string[]): void => {
  program.version(pkg.version).usage('<command> [options]');

  program
    .command('ls')
    .description('Lists all the files that will be published')
    .option('--yarn', 'Use yarn instead of npm')
    .option(
      '--packagedDependencies <path>',
      'Select packages that should be published only (includes dependencies)',
      (val, all) => (all ? all.concat(val) : [val]),
      undefined
    )
    .option('--ignoreFile [path]', 'Indicate alternative .vscodeignore')
    .action(({ yarn, packagedDependencies, ignoreFile }) =>
      main(ls(undefined, yarn, packagedDependencies, ignoreFile))
    );

  program
    .command('ls-remote')
    .description('List all extensions on a remote host.')
    .option('-c --config <path>', 'Config File', 'config.json')
    .option('--backend [backend]', 'Backend to host the extension')
    .action(({ config, backend }) => main(listRemote({ config, backend })));

  program
    .command('package')
    .description('Packages an extension')
    .option(
      '-o, --out [path]',
      'Output .vsix extension file to [path] location'
    )
    .option(
      '--baseContentUrl [url]',
      'Prepend all relative links in README.md with this url.'
    )
    .option(
      '--baseImagesUrl [url]',
      'Prepend all relative image links in README.md with this url.'
    )
    .option('--yarn', 'Use yarn instead of npm')
    .option('--ignoreFile [path]', 'Indicate alternative .vscodeignore')
    .action(({ out, baseContentUrl, baseImagesUrl, yarn, ignoreFile }) =>
      main(
        packageCommand({
          packagePath: out,
          baseContentUrl,
          baseImagesUrl,
          useYarn: yarn,
          ignoreFile,
        })
      )
    );

  program
    .command('publish [version]')
    .description('Publishes an extension')
    .option('-c --config <path>', 'Config File', 'config.json')
    .option('--backend <backend>', 'Backend to host the extension')
    .option('-f --force', 'Force to publish an extension')
    .option(
      '-m, --message <commit message>',
      'Commit message used when calling `npm version`.'
    )
    .option(
      '--packagePath [path]',
      'Publish the VSIX package located at the specified path.'
    )
    .option(
      '--baseContentUrl [url]',
      'Prepend all relative links in README.md with this url.'
    )
    .option(
      '--baseImagesUrl [url]',
      'Prepend all relative image links in README.md with this url.'
    )
    .option('--yarn', 'Use yarn instead of npm while packing extension files')
    .option('--noVerify')
    .option('--ignoreFile [path]', 'Indicate alternative .vscodeignore')
    .action(
      (
        version,
        {
          config,
          backend,
          force,
          message,
          packagePath,
          baseContentUrl,
          baseImagesUrl,
          yarn,
          noVerify,
          ignoreFile,
        }
      ) =>
        main(
          publish({
            version,
            config,
            backend,
            force,
            message,
            packagePath,
            baseContentUrl,
            baseImagesUrl,
            yarn,
            noVerify,
            ignoreFile,
          })
        )
    );

  program
    .command('unpublish [name] [version]')
    .description(
      'Unpublishes an extension. Example extension: publisher.myextension.'
    )
    .option('-c --config <path>', 'Config File', 'config.json')
    .option('--backend <backend>', 'Backend to host the extension')
    .action((name, version, { config, backend }) =>
      main(unpublish({ name, version, config, backend }))
    );

  program
    .command('show <name> [version]')
    .description('Show an extension metadata. Example extension: myextension.')
    .option('-c --config <path>', 'Config File', 'config.json')
    .option('--backend [backend]', 'Backend to host the extension')
    .action((name, version, { config, backend }) =>
      main(show({ name, version, config, backend }))
    );

  program.command('*', '', { noHelp: true }).action((cmd: string) => {
    program.help(help => {
      const suggestion = didYouMean(
        cmd,
        program.commands.map((c: { _name: any }) => c._name)
      );

      help = `${help}
Unknown command '${cmd}'`;

      return suggestion
        ? `${help}, did you mean '${suggestion}'?\n`
        : `${help}.\n`;
    });
  });

  program.parse(argv);

  if (process.argv.length <= 2) {
    program.help();
  }
};
