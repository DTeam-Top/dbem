import * as cheerio from 'cheerio';
import * as cp from 'child_process';
import denodeify from 'denodeify';
import * as fs from 'fs';
import _glob from 'glob';
import _ from 'lodash';
import markdownit from 'markdown-it';
import { lookup } from 'mime';
import minimatch from 'minimatch';
import * as path from 'path';
import * as url from 'url';
import urljoin from 'url-join';
import * as yazl from 'yazl';
import { Manifest } from './manifest';
import { patchNLS, Translations } from './nls';
import { getDependencies } from './npm';
import * as util from './util';
import {
  validateEngineCompatibility,
  validateExtensionName,
  validatePublisher,
  validateVersion,
  validateVSCodeTypesCompatibility,
} from './validation';

const readFile = denodeify<string, any, string>(fs.readFile);
const unlink = denodeify<string, void>(fs.unlink as any);
const stat: any = denodeify(fs.stat);
const exec = denodeify<
  string,
  { cwd?: string; env?: any; maxBuffer?: number },
  { stdout: string; stderr: string }
>(cp.exec as any, (err: any, stdout: any, stderr: any) => [
  err,
  { stdout, stderr },
]);
const glob = denodeify<string, any, string[]>(_glob);

const resourcesPath = path.join(path.dirname(__dirname), 'resources');
const vsixManifestTemplatePath = path.join(
  resourcesPath,
  'extension.vsixmanifest'
);
const contentTypesTemplatePath = path.join(
  resourcesPath,
  '[Content_Types].xml'
);

const MINIMATCH_OPTIONS: minimatch.IOptions = { dot: true };

export interface File {
  path: string;
  contents?: Buffer | string;
  localPath?: string;
}

export async function read(file: File): Promise<string> {
  if (file.contents) {
    return Promise.resolve(file.contents).then(b =>
      typeof b === 'string' ? b : b.toString('utf8')
    );
  } else {
    return readFile(file.localPath!, 'utf8');
  }
}

export interface Package {
  manifest: Manifest;
  packagePath: string;
}

export interface PackageResult extends Package {
  files: File[];
}

export interface Asset {
  type: string;
  path: string;
}

export interface PackageOptions {
  cwd?: string;
  packagePath?: string;
  baseContentUrl?: string;
  baseImagesUrl?: string;
  useYarn?: boolean;
  dependencyEntryPoints?: string[];
  ignoreFile?: string;
}

export interface Processor {
  onFile(file: File): Promise<File>;
  onEnd(): Promise<void>;
  assets: Asset[];
  vsix: any;
}

export class BaseProcessor implements Processor {
  constructor(protected manifest: Manifest) {}
  assets: Asset[] = [];
  vsix: any = Object.create(null);
  onFile(file: File): Promise<File> {
    return Promise.resolve(file);
  }
  onEnd() {
    return Promise.resolve();
  }
}

function getUrl(url: undefined | string | { url?: string }): string | null {
  if (!url) {
    return null;
  }

  if (typeof url === 'string') {
    return url as string;
  }

  return (url as any).url;
}

function getRepositoryUrl(url: string | { url?: string }): string | null {
  const result = getUrl(url);

  if (result && /^[^\/]+\/[^\/]+$/.test(result)) {
    return `https://github.com/${result}.git`;
  }

  return result;
}

// Contributed by Mozilla develpoer authors
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function toExtensionTags(extensions: string[]): string[] {
  return extensions
    .map(s => s.replace(/\W/g, ''))
    .filter(s => !!s)
    .map(s => `__ext_${s}`);
}

function toLanguagePackTags(
  translations: Array<{ id: string }>,
  languageId: string
): string[] {
  return (translations || [])
    .map(({ id }) => [`__lp_${id}`, `__lp-${languageId}_${id}`])
    .reduce((r, t) => [...r, ...t], []);
}

/* This list is also maintained by the Marketplace team.
 * Remember to reach out to them when adding new domains.
 */
const TRUSTED_SVG_SOURCES = [
  'api.bintray.com',
  'api.travis-ci.com',
  'api.travis-ci.org',
  'app.fossa.io',
  'badge.buildkite.com',
  'badge.fury.io',
  'badge.waffle.io',
  'badgen.net',
  'badges.frapsoft.com',
  'badges.gitter.im',
  'badges.greenkeeper.io',
  'cdn.travis-ci.com',
  'cdn.travis-ci.org',
  'ci.appveyor.com',
  'circleci.com',
  'cla.opensource.microsoft.com',
  'codacy.com',
  'codeclimate.com',
  'codecov.io',
  'coveralls.io',
  'david-dm.org',
  'deepscan.io',
  'dev.azure.com',
  'docs.rs',
  'flat.badgen.net',
  'gemnasium.com',
  'githost.io',
  'gitlab.com',
  'godoc.org',
  'goreportcard.com',
  'img.shields.io',
  'isitmaintained.com',
  'marketplace.visualstudio.com',
  'nodesecurity.io',
  'opencollective.com',
  'snyk.io',
  'travis-ci.com',
  'travis-ci.org',
  'visualstudio.com',
  'vsmarketplacebadge.apphb.com',
  'www.bithound.io',
  'www.versioneye.com',
];

function isHostTrusted(host: string): boolean {
  return TRUSTED_SVG_SOURCES.indexOf(host.toLowerCase()) > -1;
}

function isGitHubRepository(repository: string): boolean {
  return /^https:\/\/github\.com\/|^git@github\.com:/.test(repository || '');
}

class ManifestProcessor extends BaseProcessor {
  constructor(manifest: Manifest) {
    super(manifest);

    const flags = ['Public'];

    if (manifest.preview) {
      flags.push('Preview');
    }

    const repository = getRepositoryUrl(manifest.repository!);
    const isGitHub = isGitHubRepository(repository!);

    let enableMarketplaceQnA: boolean | undefined;
    let customerQnALink: string | undefined;

    if (manifest.qna === 'marketplace') {
      enableMarketplaceQnA = true;
    } else if (typeof manifest.qna === 'string') {
      customerQnALink = manifest.qna;
    } else if (manifest.qna === false) {
      enableMarketplaceQnA = false;
    }

    this.vsix = {
      ...this.vsix,
      id: manifest.name,
      displayName: manifest.displayName || manifest.name,
      version: manifest.version,
      publisher: manifest.publisher,
      engine: manifest.engines['vscode'],
      description: manifest.description || '',
      categories: (manifest.categories || []).join(','),
      flags: flags.join(' '),
      links: {
        repository,
        bugs: getUrl(manifest.bugs),
        homepage: manifest.homepage,
      },
      galleryBanner: manifest.galleryBanner || {},
      badges: manifest.badges,
      githubMarkdown: manifest.markdown !== 'standard',
      enableMarketplaceQnA,
      customerQnALink,
      extensionDependencies: _(manifest.extensionDependencies || [])
        .uniq()
        .join(','),
      extensionPack: _(manifest.extensionPack || [])
        .uniq()
        .join(','),
      localizedLanguages:
        manifest.contributes && manifest.contributes.localizations
          ? manifest.contributes.localizations
              .map(
                loc =>
                  loc.localizedLanguageName ||
                  loc.languageName ||
                  loc.languageId
              )
              .join(',')
          : '',
    };

    if (isGitHub) {
      this.vsix.links.github = repository;
    }
  }

  async onEnd(): Promise<void> {
    if (typeof this.manifest.extensionKind === 'string') {
      util.log.warn(
        `The 'extensionKind' property should be of type 'string[]'. Learn more at: https://aka.ms/vscode/api/incorrect-execution-location`
      );
    }

    if (this.manifest.publisher === 'vscode-samples') {
      throw new Error(
        "It's not allowed to use the 'vscode-samples' publisher. Learn more at: https://code.visualstudio.com/api/working-with-extensions/publishing-extension."
      );
    }

    if (!this.manifest.repository) {
      util.log.warn(
        `A 'repository' field is missing from the 'package.json' manifest file.`
      );

      if (!/^y$/i.test(await util.read('Do you want to continue? [y/N] '))) {
        throw new Error('Aborted');
      }
    }
  }
}

export class TagsProcessor extends BaseProcessor {
  private static KEYWORDS: { [key: string]: string[] } = {
    git: ['git'],
    npm: ['node'],
    spell: ['markdown'],
    bootstrap: ['bootstrap'],
    lint: ['linters'],
    linting: ['linters'],
    react: ['javascript'],
    js: ['javascript'],
    node: ['javascript', 'node'],
    'c++': ['c++'],
    Cplusplus: ['c++'],
    xml: ['xml'],
    angular: ['javascript'],
    jquery: ['javascript'],
    php: ['php'],
    python: ['python'],
    latex: ['latex'],
    ruby: ['ruby'],
    java: ['java'],
    erlang: ['erlang'],
    sql: ['sql'],
    nodejs: ['node'],
    'c#': ['c#'],
    css: ['css'],
    javascript: ['javascript'],
    ftp: ['ftp'],
    haskell: ['haskell'],
    unity: ['unity'],
    terminal: ['terminal'],
    powershell: ['powershell'],
    laravel: ['laravel'],
    meteor: ['meteor'],
    emmet: ['emmet'],
    eslint: ['linters'],
    tfs: ['tfs'],
    rust: ['rust'],
  };

  onEnd(): Promise<void> {
    const keywords = this.manifest.keywords || [];
    const contributes = this.manifest.contributes;
    const activationEvents = this.manifest.activationEvents || [];
    const doesContribute = (name: string) =>
      contributes && contributes[name] && contributes[name].length > 0;

    const colorThemes = doesContribute('themes')
      ? ['theme', 'color-theme']
      : [];
    const iconThemes = doesContribute('iconThemes')
      ? ['theme', 'icon-theme']
      : [];
    const snippets = doesContribute('snippets') ? ['snippet'] : [];
    const keybindings = doesContribute('keybindings') ? ['keybindings'] : [];
    const debuggers = doesContribute('debuggers') ? ['debuggers'] : [];
    const json = doesContribute('jsonValidation') ? ['json'] : [];

    const localizationContributions = (
      (contributes && contributes['localizations']) ||
      []
    ).reduce(
      (r, l) =>
        [
          ...r,
          `lp-${l.languageId}`,
          ...toLanguagePackTags(l.translations, l.languageId),
        ] as any,
      []
    );

    const languageContributions = (
      (contributes && contributes['languages']) ||
      []
    ).reduce(
      (r: any, l: any) => [
        ...r,
        l.id,
        ...(l.aliases || []),
        ...toExtensionTags(l.extensions || []),
      ],
      []
    );

    const languageActivations = activationEvents
      .map(e => /^onLanguage:(.*)$/.exec(e))
      .filter(r => !!r)
      .map(r => r![1]);

    const grammars = ((contributes && contributes['grammars']) || []).map(
      (g: { language: any }) => g.language
    );

    const description = this.manifest.description || '';
    const descriptionKeywords = Object.keys(TagsProcessor.KEYWORDS).reduce(
      (r, k) =>
        r.concat(
          new RegExp('\\b(?:' + escapeRegExp(k) + ')(?!\\w)', 'gi').test(
            description
          )
            ? (TagsProcessor.KEYWORDS[k] as any)
            : []
        ),
      []
    );

    const tags = [
      ...keywords,
      ...colorThemes,
      ...iconThemes,
      ...snippets,
      ...keybindings,
      ...debuggers,
      ...json,
      ...localizationContributions,
      ...languageContributions,
      ...languageActivations,
      ...grammars,
      ...descriptionKeywords,
    ];

    this.vsix.tags = _(tags)
      .uniq() // deduplicate
      .compact() // remove falsey values
      .join(',');

    return Promise.resolve();
  }
}

export class MarkdownProcessor extends BaseProcessor {
  private baseContentUrl: string;
  private baseImagesUrl: string;
  private isGitHub: boolean;
  private repositoryUrl: string;

  constructor(
    manifest: Manifest,
    private name: string,
    private regexp: RegExp,
    private assetType: string,
    options: PackageOptions = {}
  ) {
    super(manifest);

    const guess = this.guessBaseUrls();

    this.baseContentUrl =
      options.baseContentUrl || ((guess && guess.content) as any);
    this.baseImagesUrl =
      options.baseImagesUrl ||
      options.baseContentUrl ||
      ((guess && guess.images) as any);
    this.repositoryUrl = guess && (guess.repository as any);
    this.isGitHub = isGitHubRepository(this.repositoryUrl);
  }

  async onFile(file: File): Promise<File> {
    const path = util.normalize(file.path);

    if (!this.regexp.test(path)) {
      return Promise.resolve(file);
    }

    this.assets.push({ type: this.assetType, path });

    let contents = await read(file);

    if (/This is the README for your extension /.test(contents)) {
      throw new Error(
        `Make sure to edit the README.md file before you package or publish your extension.`
      );
    }

    const markdownPathRegex = /(!?)\[([^\]\[]*|!\[[^\]\[]*]\([^\)]+\))\]\(([^\)]+)\)/g;
    const urlReplace = (_: any, isImage: any, title: string, link: any) => {
      const isLinkRelative = !/^\w+:\/\//.test(link) && link[0] !== '#';

      if (!this.baseContentUrl && !this.baseImagesUrl) {
        const asset = isImage ? 'image' : 'link';

        if (isLinkRelative) {
          throw new Error(
            `Couldn't detect the repository where this extension is published. The ${asset} '${link}' will be broken in ${this.name}. Please provide the repository URL in package.json or use the --baseContentUrl and --baseImagesUrl options.`
          );
        }
      }

      title = title.replace(markdownPathRegex, urlReplace);
      const prefix = isImage ? this.baseImagesUrl : this.baseContentUrl;

      if (!prefix || !isLinkRelative) {
        return `${isImage}[${title}](${link})`;
      }

      return `${isImage}[${title}](${urljoin(prefix, link)})`;
    };

    // Replace Markdown links with urls
    contents = contents.replace(markdownPathRegex, urlReplace);

    // Replace <img> links with urls
    contents = contents.replace(
      /<img.+?src=["']([/.\w\s-]+)['"].*?>/g,
      (all, link) => {
        const isLinkRelative = !/^\w+:\/\//.test(link) && link[0] !== '#';

        if (!this.baseImagesUrl && isLinkRelative) {
          throw new Error(
            `Couldn't detect the repository where this extension is published. The image will be broken in ${this.name}. Please provide the repository URL in package.json or use the --baseContentUrl and --baseImagesUrl options.`
          );
        }
        const prefix = this.baseImagesUrl;

        if (!prefix || !isLinkRelative) {
          return all;
        }

        return all.replace(link, urljoin(prefix, link));
      }
    );

    const markdownIssueRegex = /(\s|\n)([\w\d_-]+\/[\w\d_-]+)?#(\d+)\b/g;
    const issueReplace = (
      all: string,
      prefix: string,
      ownerAndRepositoryName: string,
      issueNumber: string
    ): string => {
      let result = all;
      let owner: string | undefined;
      let repositoryName: string | undefined;

      if (ownerAndRepositoryName) {
        [owner, repositoryName] = ownerAndRepositoryName.split('/', 2);
      }

      if (this.isGitHub) {
        if (owner && repositoryName && issueNumber) {
          // Issue in external repository
          const issueUrl = urljoin(
            'https://github.com',
            owner,
            repositoryName,
            'issues',
            issueNumber
          );
          result =
            prefix + `[${owner}/${repositoryName}#${issueNumber}](${issueUrl})`;
        } else if (!owner && !repositoryName && issueNumber) {
          // Issue in own repository
          result =
            prefix +
            `[#${issueNumber}](${urljoin(
              this.repositoryUrl,
              'issues',
              issueNumber
            )})`;
        }
      }

      return result;
    };
    // Replace Markdown issue references with urls
    contents = contents.replace(markdownIssueRegex, issueReplace);

    const html = markdownit({ html: true }).render(contents);
    const $ = cheerio.load(html);

    $('img').each((_, img) => {
      const src = decodeURI(img.attribs.src);
      const srcUrl = url.parse(src);

      if (
        /^data:$/i.test(srcUrl.protocol as any) &&
        /^image$/i.test(srcUrl.host as any) &&
        /\/svg/i.test(srcUrl.path as any)
      ) {
        throw new Error(
          `SVG data URLs are not allowed in ${this.name}: ${src}`
        );
      }

      if (!/^https:$/i.test(srcUrl.protocol as any)) {
        throw new Error(
          `Images in ${this.name} must come from an HTTPS source: ${src}`
        );
      }

      if (
        /\.svg$/i.test(srcUrl.pathname as any) &&
        !isHostTrusted(srcUrl.host as any)
      ) {
        throw new Error(
          `SVGs are restricted in ${this.name}; please use other file image formats, such as PNG: ${src}`
        );
      }
    });

    $('svg').each(() => {
      throw new Error(`SVG tags are not allowed in ${this.name}.`);
    });

    return {
      path: file.path,
      contents: Buffer.from(contents, 'utf8'),
    };
  }

  // GitHub heuristics
  private guessBaseUrls(): {
    content: string;
    images: string;
    repository: string;
  } | null {
    let repository = null;

    if (typeof this.manifest.repository === 'string') {
      repository = this.manifest.repository;
    } else if (
      this.manifest.repository &&
      typeof this.manifest.repository['url'] === 'string'
    ) {
      repository = this.manifest.repository['url'];
    }

    if (!repository) {
      return null;
    }

    const regex = /github\.com\/([^/]+)\/([^/]+)(\/|$)/;
    const match = regex.exec(repository);

    if (!match) {
      return null;
    }

    const account = match[1];
    const repositoryName = match[2].replace(/\.git$/i, '');

    return {
      content: `https://github.com/${account}/${repositoryName}/blob/master`,
      images: `https://github.com/${account}/${repositoryName}/raw/master`,
      repository: `https://github.com/${account}/${repositoryName}`,
    };
  }
}

export class ReadmeProcessor extends MarkdownProcessor {
  constructor(manifest: Manifest, options: PackageOptions = {}) {
    super(
      manifest,
      'README.md',
      /^extension\/readme.md$/i,
      'Microsoft.VisualStudio.Services.Content.Details',
      options
    );
  }
}
export class ChangelogProcessor extends MarkdownProcessor {
  constructor(manifest: Manifest, options: PackageOptions = {}) {
    super(
      manifest,
      'CHANGELOG.md',
      /^extension\/changelog.md$/i,
      'Microsoft.VisualStudio.Services.Content.Changelog',
      options
    );
  }
}

class LicenseProcessor extends BaseProcessor {
  private didFindLicense = false;
  private filter: (name: string) => boolean;

  constructor(manifest: Manifest) {
    super(manifest);

    const match = /^SEE LICENSE IN (.*)$/.exec(manifest.license || '');

    if (!match || !match[1]) {
      this.filter = name => /^extension\/license(\.(md|txt))?$/i.test(name);
    } else {
      const regexp = new RegExp('^extension/' + match[1] + '$');
      this.filter = regexp.test.bind(regexp);
    }

    this.vsix.license = null;
  }

  onFile(file: File): Promise<File> {
    if (!this.didFindLicense) {
      let normalizedPath = util.normalize(file.path);

      if (this.filter(normalizedPath)) {
        if (!path.extname(normalizedPath)) {
          file.path += '.txt';
          normalizedPath += '.txt';
        }

        this.assets.push({
          type: 'Microsoft.VisualStudio.Services.Content.License',
          path: normalizedPath,
        });
        this.vsix.license = normalizedPath;
        this.didFindLicense = true;
      }
    }

    return Promise.resolve(file);
  }
}

class IconProcessor extends BaseProcessor {
  private icon: string | null;
  private didFindIcon = false;

  constructor(manifest: Manifest) {
    super(manifest);

    this.icon = manifest.icon ? `extension/${manifest.icon}` : null;
    this.vsix.icon = null;
  }

  onFile(file: File): Promise<File> {
    const normalizedPath = util.normalize(file.path);
    if (normalizedPath === this.icon) {
      this.didFindIcon = true;
      this.assets.push({
        type: 'Microsoft.VisualStudio.Services.Icons.Default',
        path: normalizedPath,
      });
      this.vsix.icon = this.icon;
    }
    return Promise.resolve(file);
  }

  onEnd(): Promise<void> {
    if (this.icon && !this.didFindIcon) {
      return Promise.reject(
        new Error(
          `The specified icon '${this.icon}' wasn't found in the extension.`
        )
      );
    }

    return Promise.resolve();
  }
}

export class NLSProcessor extends BaseProcessor {
  private translations: { [path: string]: string } = Object.create(null);

  constructor(manifest: Manifest) {
    super(manifest);

    if (
      !manifest.contributes ||
      !manifest.contributes.localizations ||
      manifest.contributes.localizations.length === 0
    ) {
      return;
    }

    const localizations = manifest.contributes.localizations;
    const translations: { [languageId: string]: string } = Object.create(null);

    // take last reference in the manifest for any given language
    for (const localization of localizations) {
      for (const translation of localization.translations) {
        if (translation.id === 'vscode' && !!translation.path) {
          const translationPath = util.normalize(
            translation.path.replace(/^\.[\/\\]/, '')
          );
          translations[
            localization.languageId.toUpperCase()
          ] = `extension/${translationPath}`;
        }
      }
    }

    // invert the map for later easier retrieval
    for (const languageId of Object.keys(translations)) {
      this.translations[translations[languageId]] = languageId;
    }
  }

  onFile(file: File): Promise<File> {
    const normalizedPath = util.normalize(file.path);
    const language = this.translations[normalizedPath];

    if (language) {
      this.assets.push({
        type: `Microsoft.VisualStudio.Code.Translation.${language}`,
        path: normalizedPath,
      });
    }

    return Promise.resolve(file);
  }
}

export class ValidationProcessor extends BaseProcessor {
  private files = new Map<string, string[]>();
  private duplicates = new Set<string>();

  async onFile(file: File): Promise<File> {
    const lower = file.path.toLowerCase();
    const existing = this.files.get(lower);

    if (existing) {
      this.duplicates.add(lower);
      existing.push(file.path);
    } else {
      this.files.set(lower, [file.path]);
    }

    return file;
  }

  async onEnd() {
    if (this.duplicates.size === 0) {
      return;
    }

    const messages = [
      `The following files have the same case insensitive path, which isn't supported by the VSIX format:`,
    ];

    for (const lower of this.duplicates) {
      for (const filePath of this.files.get(lower) as any) {
        messages.push(`  - ${filePath}`);
      }
    }

    throw new Error(messages.join('\n'));
  }
}

export function validateManifest(manifest: Manifest): Manifest {
  validatePublisher(manifest.publisher);
  validateExtensionName(manifest.name);

  if (!manifest.version) {
    throw new Error('Manifest missing field: version');
  }

  validateVersion(manifest.version);

  if (!manifest.engines) {
    throw new Error('Manifest missing field: engines');
  }

  if (!manifest.engines['vscode']) {
    throw new Error('Manifest missing field: engines.vscode');
  }

  validateEngineCompatibility(manifest.engines['vscode']);

  if (manifest.devDependencies && manifest.devDependencies['@types/vscode']) {
    validateVSCodeTypesCompatibility(
      manifest.engines['vscode'],
      manifest.devDependencies['@types/vscode']
    );
  }

  if (/\.svg$/i.test(manifest.icon || '')) {
    throw new Error(`SVGs can't be used as icons: ${manifest.icon}`);
  }

  (manifest.badges || []).forEach(badge => {
    const decodedUrl = decodeURI(badge.url);
    const srcUrl = url.parse(decodedUrl);

    if (!/^https:$/i.test(srcUrl.protocol as any)) {
      throw new Error(
        `Badge URLs must come from an HTTPS source: ${badge.url}`
      );
    }

    if (
      /\.svg$/i.test(srcUrl.pathname as any) &&
      !isHostTrusted(srcUrl.host as any)
    ) {
      throw new Error(
        `Badge SVGs are restricted. Please use other file image formats, such as PNG: ${badge.url}`
      );
    }
  });

  Object.keys(manifest.dependencies || {}).forEach(dep => {
    if (dep === 'vscode') {
      throw new Error(
        `You should not depend on 'vscode' in your 'dependencies'. Did you mean to add it to 'devDependencies'?`
      );
    }
  });

  return manifest;
}

export async function readManifest(
  cwd = process.cwd(),
  nls = true
): Promise<Manifest> {
  const manifestPath = path.join(cwd, 'package.json');
  const manifestNLSPath = path.join(cwd, 'package.nls.json');

  const manifest = readFile(manifestPath, 'utf8')
    .catch(() =>
      Promise.reject(`Extension manifest not found: ${manifestPath}`)
    )
    .then<Manifest>((manifestStr: string) => {
      try {
        return Promise.resolve(JSON.parse(manifestStr));
      } catch (e) {
        return Promise.reject(
          `Error parsing 'package.json' manifest file: not a valid JSON file.`
        );
      }
    })
    .then(validateManifest);

  if (!nls) {
    return manifest;
  }

  const manifestNLS = readFile(manifestNLSPath, 'utf8')
    .catch<string>((err: { code: string }) =>
      err.code !== 'ENOENT' ? Promise.reject(err) : Promise.resolve('{}')
    )
    .then<Translations>((raw: string) => {
      try {
        return Promise.resolve(JSON.parse(raw));
      } catch (e) {
        return Promise.reject(
          `Error parsing JSON manifest translations file: ${manifestNLSPath}`
        );
      }
    });

  const [manifest2, translations] = await Promise.all([manifest, manifestNLS]);
  return patchNLS(manifest2, translations);
}

export function toVsixManifest(vsix: any): Promise<string> {
  return readFile(vsixManifestTemplatePath, 'utf8')
    .then((vsixManifestTemplateStr: string | undefined) =>
      _.template(vsixManifestTemplateStr)
    )
    .then((vsixManifestTemplate: (arg0: any) => any) =>
      vsixManifestTemplate(vsix)
    );
}

const defaultExtensions = {
  '.json': 'application/json',
  '.vsixmanifest': 'text/xml',
};

export async function toContentTypes(files: File[]): Promise<string> {
  const extensions = Object.keys(
    _.keyBy(files, f => path.extname(f.path).toLowerCase())
  )
    .filter(e => !!e)
    .reduce((r, e) => ({ ...r, [e]: lookup(e) }), {});

  const allExtensions: { [key: string]: string } = {
    ...extensions,
    ...defaultExtensions,
  };
  const contentTypes = Object.keys(allExtensions).map((extension: string) => ({
    extension,
    contentType: allExtensions[extension],
  }));

  return readFile(contentTypesTemplatePath, 'utf8')
    .then((contentTypesTemplateStr: string | undefined) =>
      _.template(contentTypesTemplateStr)
    )
    .then(
      (
        contentTypesTemplate: (arg0: {
          contentTypes: Array<{ extension: string; contentType: string }>;
        }) => any
      ) => contentTypesTemplate({ contentTypes })
    );
}

const defaultIgnore = [
  '.vscodeignore',
  'package-lock.json',
  'yarn.lock',
  '.editorconfig',
  '.npmrc',
  '.yarnrc',
  '.gitattributes',
  '*.todo',
  'tslint.yaml',
  '.eslintrc*',
  '.babelrc*',
  '.prettierrc',
  'ISSUE_TEMPLATE.md',
  'CONTRIBUTING.md',
  'PULL_REQUEST_TEMPLATE.md',
  'CODE_OF_CONDUCT.md',
  '.github',
  '.travis.yml',
  'appveyor.yml',
  '**/.git/**',
  '**/*.vsix',
  '**/.DS_Store',
  '**/*.vsixmanifest',
  '**/.vscode-test/**',
];

function collectAllFiles(
  cwd: string,
  useYarn = false,
  dependencyEntryPoints?: string[]
): Promise<string[]> {
  return getDependencies(cwd, useYarn, dependencyEntryPoints).then(deps => {
    const promises: Array<Promise<string[]>> = deps.map(dep => {
      return glob('**', {
        cwd: dep,
        nodir: true,
        dot: true,
        ignore: 'node_modules/**',
      }).then((files: any[]) =>
        files
          .map((f: string) => path.relative(cwd, path.join(dep, f)))
          .map((f: string) => f.replace(/\\/g, '/'))
      );
    });

    return Promise.all(promises).then(util.flatten);
  });
}

function collectFiles(
  cwd: string,
  useYarn = false,
  dependencyEntryPoints?: string[],
  ignoreFile?: string
): Promise<string[]> {
  return collectAllFiles(cwd, useYarn, dependencyEntryPoints).then(files => {
    files = files.filter(f => !/\r$/m.test(f));

    return (
      readFile(
        ignoreFile ? ignoreFile : path.join(cwd, '.vscodeignore'),
        'utf8'
      )
        .catch<string>((err: { code: string }) =>
          err.code !== 'ENOENT'
            ? Promise.reject(err)
            : ignoreFile
            ? Promise.reject(err)
            : Promise.resolve('')
        )

        // Parse raw ignore by splitting output into lines and filtering out empty lines and comments
        .then((rawIgnore: string) =>
          rawIgnore
            .split(/[\n\r]/)
            .map((s: string) => s.trim())
            .filter((s: any) => !!s)
            .filter((i: string) => !/^\s*#/.test(i))
        )

        // Add '/**' to possible folder names
        .then((ignore: any[]) => [
          ...ignore,
          ...ignore
            .filter(i => !/(^|\/)[^/]*\*[^/]*$/.test(i))
            .map(i => (/\/$/.test(i) ? `${i}**` : `${i}/**`)),
        ])

        // Combine with default ignore list
        .then((ignore: any) => [...defaultIgnore, ...ignore, '!package.json'])

        // Split into ignore and negate list
        .then((ignore: any) => _.partition(ignore, i => !/^\s*!/.test(i)))
        .then((r: any[]) => ({ ignore: r[0], negate: r[1] }))

        // Filter out files
        .then(({ ignore, negate }) =>
          files.filter(
            f =>
              !ignore.some((i: any) => minimatch(f, i, MINIMATCH_OPTIONS)) ||
              negate.some((i: string) =>
                minimatch(f, i.substr(1), MINIMATCH_OPTIONS)
              )
          )
        )
    );
  });
}

export function processFiles(
  processors: Processor[],
  files: File[]
): Promise<File[]> {
  const processedFiles = files.map(file =>
    util.chain(file, processors, (file, processor) => processor.onFile(file))
  );

  return Promise.all(processedFiles).then(files => {
    return util.sequence(processors.map(p => () => p.onEnd())).then(() => {
      const assets = _.flatten(processors.map(p => p.assets));
      const vsix = processors.reduce((r, p) => ({ ...r, ...p.vsix }), {
        assets,
      });

      return Promise.all([toVsixManifest(vsix), toContentTypes(files)]).then(
        result => {
          return [
            {
              path: 'extension.vsixmanifest',
              contents: Buffer.from(result[0], 'utf8'),
            },
            {
              path: '[Content_Types].xml',
              contents: Buffer.from(result[1], 'utf8'),
            },
            ...files,
          ];
        }
      );
    });
  });
}

export function createDefaultProcessors(
  manifest: Manifest,
  options: PackageOptions = {}
): Processor[] {
  return [
    new ManifestProcessor(manifest),
    new TagsProcessor(manifest),
    new ReadmeProcessor(manifest, options),
    new ChangelogProcessor(manifest, options),
    new LicenseProcessor(manifest),
    new IconProcessor(manifest),
    new NLSProcessor(manifest),
    new ValidationProcessor(manifest),
  ];
}

export function collect(
  manifest: Manifest,
  options: PackageOptions = {}
): Promise<File[]> {
  const cwd = options.cwd || process.cwd();
  const useYarn = options.useYarn || false;
  const packagedDependencies = options.dependencyEntryPoints || undefined;
  const ignoreFile = options.ignoreFile || undefined;
  const processors = createDefaultProcessors(manifest, options);

  return collectFiles(cwd, useYarn, packagedDependencies, ignoreFile).then(
    fileNames => {
      const files = fileNames.map(f => ({
        path: `extension/${f}`,
        localPath: path.join(cwd, f),
      }));

      return processFiles(processors, files);
    }
  );
}

function writeVsix(files: File[], packagePath: string): Promise<void> {
  return unlink(packagePath)
    .catch((err: { code: string }) =>
      err.code !== 'ENOENT' ? Promise.reject(err) : Promise.resolve(null)
    )
    .then(
      () =>
        new Promise((c, e) => {
          const zip = new yazl.ZipFile();
          files.forEach(f =>
            f.contents
              ? zip.addBuffer(
                  typeof f.contents === 'string'
                    ? Buffer.from(f.contents, 'utf8')
                    : f.contents,
                  f.path
                )
              : zip.addFile(f.localPath!, f.path)
          );
          zip.end();

          const zipStream = fs.createWriteStream(packagePath);
          zip.outputStream.pipe(zipStream);

          zip.outputStream.once('error', e);
          zipStream.once('error', e);
          zipStream.once('finish', () => c());
        })
    );
}

function getDefaultPackageName(manifest: Manifest): string {
  return `${manifest.name}-${manifest.version}.vsix`;
}

async function prepublish(
  cwd: string,
  manifest: Manifest,
  useYarn = false
): Promise<void> {
  if (!manifest.scripts || !manifest.scripts['vscode:prepublish']) {
    return;
  }

  console.warn(
    `Executing prepublish script '${
      useYarn ? 'yarn && yarn' : 'npm ci && npm'
    } run vscode:prepublish'...`
  );

  const { stdout, stderr } = await exec(
    `${useYarn ? 'yarn && yarn' : 'npm ci && npm'} run vscode:prepublish`,
    { cwd, maxBuffer: 5000 * 1024 }
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

async function getPackagePath(
  cwd: string,
  manifest: Manifest,
  options: PackageOptions = {}
): Promise<string> {
  if (!options.packagePath) {
    return path.join(cwd, getDefaultPackageName(manifest));
  }

  try {
    const _stat = await stat(options.packagePath);

    if (_stat.isDirectory()) {
      return path.join(options.packagePath, getDefaultPackageName(manifest));
    } else {
      return options.packagePath;
    }
  } catch {
    return options.packagePath;
  }
}

export async function pack(
  options: PackageOptions = {}
): Promise<PackageResult> {
  const cwd = options.cwd || process.cwd();

  const manifest = await readManifest(cwd);
  await prepublish(cwd, manifest, options.useYarn);

  const files = await collect(manifest, options);
  const jsFiles = files.filter(f => /\.js$/i.test(f.path));

  if (files.length > 5000 || jsFiles.length > 100) {
    console.log(
      `This extension consists of ${files.length} files, out of which ${jsFiles.length} are JavaScript files. For performance reasons, you should bundle your extension: https://aka.ms/vscode-bundle-extension . You should also exclude unnecessary files by adding them to your .vscodeignore: https://aka.ms/vscode-vscodeignore`
    );
  }

  const packagePath = await getPackagePath(cwd, manifest, options);
  await writeVsix(files, path.resolve(packagePath));

  return { manifest, packagePath, files };
}

export async function packageCommand(
  options: PackageOptions = {}
): Promise<any> {
  const { packagePath, files } = await pack(options);
  const stats = await stat(packagePath);

  let size = 0;
  let unit = '';

  if (stats.size > 1048576) {
    size = Math.round(stats.size / 10485.76) / 100;
    unit = 'MB';
  } else {
    size = Math.round(stats.size / 10.24) / 100;
    unit = 'KB';
  }

  util.log.done(
    `Packaged: ${packagePath} (${files.length} files, ${size}${unit})`
  );
}

/**
 * Lists the files included in the extension's package. Does not run prepublish.
 */
export async function listFiles(
  cwd = process.cwd(),
  useYarn = false,
  packagedDependencies?: string[],
  ignoreFile?: string
): Promise<string[]> {
  return readManifest(cwd).then(() =>
    collectFiles(cwd, useYarn, packagedDependencies, ignoreFile)
  );
}

/**
 * Lists the files included in the extension's package. Runs prepublish.
 */
export async function ls(
  cwd = process.cwd(),
  useYarn = false,
  packagedDependencies?: string[],
  ignoreFile?: string
): Promise<void> {
  return readManifest(cwd)
    .then(manifest => prepublish(cwd, manifest, useYarn))
    .then(() => collectFiles(cwd, useYarn, packagedDependencies, ignoreFile))
    .then(files => files.forEach(f => console.log(`${f}`)));
}
