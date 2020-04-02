# dbem

[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

[![NPM](https://nodei.co/npm/dbem.png?compact=true)](https://nodei.co/npm/dbem/)

> _The DBox Extension Manager_

[中文版](README-cn.md)

## Requirement

- [Node.js](https://nodejs.org/en/) >= `8.x.x`

## Installation

```shell
npm install -g dbem
```

## Design

`dbem` is a fork of [`vsce`](https://github.com/Microsoft/vscode-vsce) with important refactory to support common cloud storage backends, such as AWS S3. Also, it removed some unnecessory commands and functions for private extension repositories, such as api.ts.

### Architecture

The architecture of `dbem` is composed of:

- cli: an user interface layer to operate private extension repositories.
- command: a command implementation layer.
- provider: a interface for cloud storage backends.
- backend: a specific implementation of a provider, such as aliyun oss.

### Configuration

To use dbem, a config file which saved authentication informations for connecting backend service is needed.

It is a JSON file, the keys used in this file:

- `backends`: definitions of backends used by `dbem`, its value is a JSON:
  - each key is a type of backend, each value are options for that backend type. The key must be one of:
    - `oss`: Aliyun OSS
    - `s3`: AWS S3
    - `dropbox`: DropBox

A typical config file:

```json
{
  "backends": {
    "s3": {
      "accessKeyId": "...",
      "secretAccessKey": "...",
      "region": "...",
      "bucket": "..."
    },
    "dropbox": {
      "accessToken": "..."
    },
    "oss": {
      "accessKeyId": "...",
      "accessKeySecret": "...",
      "region": "...",
      "bucket": "..."
    }
  }
}
```

When using `dbem`, user can point backend used with `--backend` option. Default, dbem will find "config.json" in current working directory. However, you can use another config file with `-c` option.

### Subcommands

`dbem` provides following subcommands for extention developers:

- `ls`, list all files which will be published.
- `ls-remote`, list names of remote extensions.
- `show`, show details about an remote extension.
- `package`, packaging an extension.
- `publish`, upload an extension to a remote repository.
- `unpublish`, delete an extension in remote repository.
- `version`, show version of dbem.
- `help`, show help of dbem.

For each subcommand (except `ls`, `version`, `help`), user can run it like below:

```shell
dbem <command> [-c config] [--backend backend] arguments
```

explaination:

- `config`, a config file which default value is "config.json" in current working directory.
- `backend`, a backend in the config file, its default value is the first backend defined in config. In example above, it is `s3`.

### Backend Provider Interface

Provider interface abstracts away the interaction with backend service, then command handlers do not need to know those details. For interface definition, please check [provider.ts](src/provider.ts).

### Spec of extensions organization in a repository

To organize extensions effectively, the rules used by a backend service:

- A `metadata` file recording extensions tree is saved in root, its content is a json array. For each json item in it:
  - `extId`: extension id, format is "publisher.name", eg: dteam.another-ext
  - `currentVersion`, extension current version.
  - `icon`, extension logo, optional. Note, it a Data URI scheme, just like: "data:image/png;base64,……".
  - `describe`, extension description.
  - `dateCreated`, the first date when an extension is published.
  - `lastUpdate`, the last date when an extension is published.
- Each child directory includes all public versions of an extension, and the name of this child directory is the name of this extension.
- Each version (which following SemVer spec, such as `0.0.1`) in an extension directory is also a directory, it including:
  - Extension package: .vsix file
  - README.md, optional
  - CHANGELOG.md, optional

A metadata example:

```json
[
  {
    "extId": "dteam.my-ext",
    "currentVersion": "0.0.1",
    "icon": "",
    "describe": "my-ext",
    "dateCreated": "2020-02-28",
    "lastUpdate": "2020-02-29"
  },
  {
    "extId": "dteam.another-ext",
    "currentVersion": "0.0.2",
    "icon": "data:image/png;base64,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",
    "describe": "another-ext",
    "dateCreated": "2020-02-28",
    "lastUpdate": "2020-02-29"
  }
]
```

A typical extension directory tree:

```txt
|- my-extension
    |-  0.0.1
          |- my-extension-0.0.1.vsix
          |- READMD.md
          |- CHANGELOG.md
    |-  0.0.2
```

[test-data](../dbox-repo/test-data) in dbox-repo project shows an example about data organization of an extensions repository, please find more details in it.

When publishing an extension:

- A version directory will be created for every publishing.
- Overriding action will be happened if same version directory existing: re-created after deleting.

## Workflow

The whole workflow of `dbem`:

- Create an extension project, please check [this guide](https://code.visualstudio.com/api/get-started/your-first-extension).
- Develop, debug and test the extension, please check [Extension Development Guide](https://code.visualstudio.com/api).
- Pack extension: `dbem package`.
- Config authentication information of backend service, please check the document of the backend service used.
- publish extension: `dbem publish`.

## Local Development

- npm run compile
- npm link
- npm unlink, used when clearing local enviroment.

## Backend Configuration

Currently, `dbem` supports three kinds of backends: aliyun oss, aws s3 and dropbox.

### Aliyun OSS

Note: `dbem` will not create bucket automatically, please create a bucket in a region first.

Using Aliyun OSS as a backend, the access credential (`AccessKeyID`/`AccessKeySecret`) must be created. For the sake of safety, in production enviroment, please grant this credential to a child account with limit permissions. Please check [this guide](https://help.aliyun.com/document_detail/31867.html) for more details.

Common parameters:

| Parameters      | Type   | Description     | Example                  |
| --------------- | ------ | --------------- | ------------------------ |
| accessKeyId     | string | AccessKeyID     | `qhxxXxXxXxxxxXXX`       |
| accessKeySecret | string | AccessKeySecret | `RkLjrXXXXxxxxxXXXXXxxx` |
| region          | string | OSS Region      | `oss-cn-hangzhou`        |
| bucket          | string | OSS Bucket      | `dbox-repo`              |

> Please check [Document](https://github.com/ali-sdk/ali-oss#ossoptions) of [ali-oss sdk](https://github.com/ali-sdk/ali-oss) for more details.

### AWS S3

Note: dbem will not create bucket automatically, please create a bucket in a region first.

To create a S3 authentication credential, please check ["Getting Your Credentials"](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-your-credentials.html) in "Developer Guide for SDK v2". For the sake of safety, in production enviroment, please select `IAM` user credential with limit permission. For more details please read ["Permissions Required to Access IAM Resources"](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_permissions-required.html).

Common parameters:

| Parameters      | Type   | Description     | Example                                    |
| --------------- | ------ | --------------- | ------------------------------------------ |
| accessKeyId     | string | AccessKeyID     | `AKIAIOSFODNN7EXAMPLE`                     |
| secretAccessKey | string | SecretAccessKey | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| region          | string | S3 Region       | `us-west-2`                                |
| bucket          | string | s3 Bucket       | `dbox-repo`                                |

> Please check [S3 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor_details) for more details.

### DropBox

Using Dropbox as a backend, a Dropbox API access credential must be created.

Please check [Document](https://www.dropbox.com/developers/reference/getting-started#app%20console):

1. Create a Dropbox App: `Choose the type of access you need` -> `App folder`.
1. In App Setting: `OAuth 2` -> `Generated access token` -> `Generate` -> `access token`.

Common parameters:

| Parameters  | Type   | Description         | Example             |
| ----------- | ------ | ------------------- | ------------------- |
| accessToken | string | OAuth2 access token | `8zXXXXXxxxx-XXXX-` |

> Please check [Dropbox SDK](https://dropbox.github.io/dropbox-sdk-js/Dropbox.html#Dropbox__anchor) for more details.
