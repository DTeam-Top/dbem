# dbem

[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

[![NPM](https://nodei.co/npm/dbem.png?compact=true)](https://nodei.co/npm/dbem/)

> _The DBox Extension Manager_

[English](README.md)

## 需求

- [Node.js](https://nodejs.org/en/) >= `8.x.x`

## 安装

```shell
npm install -g dbem
```

## 设计

`dbem` 基于 [vsce](https://github.com/Microsoft/vscode-vsce) 进行了重要的重构使之支持多后端，同时去除了部分对于私有 extension repositories 而言并不必要的命令和功能（如 api.ts ）。

### 架构

`dbem` 架构分为以下几个层级：

- cli：暴露底层命令供用户使用。
- command：命令实现层。
- provider：后端存储 provider 接口
- backend：实现 provider 接口，对接实际的后端存储服务，如 aliyun oss、aws s3 等。

### 配置文件

同时，正常运行 `dbem` 还需要有一个配置文件，此配置文件的目的主要用来保存对接后端存储服务所需的认证信息。

配置文件采用 JSON 格式，相关属性如下：

- `backends`，后端存储服务属性定义，其值为 JSON 格式：
  - 每个 key 代表存储类型，每个 value 为对应后端服务所需的属性。key 的可选值有：
    - `oss`：阿里云 OSS
    - `s3`：AWS S3
    - `dropbox`：DropBox

典型配置文件示例如下：

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

在实际使用时，可通过命令行参数（`--backend`）指定所需对接的后端存储服务。`dbem` 默认会从当前目录寻找 “config.json”，但用户可以通过命令行参数 `-c` 来指定配置文件的位置。

### 命令

dbem 提供以下命令供插件开发者管理插件：

- `ls`，列出所有将发布的文件
- `ls-remote`，列出远程的所有的插件名称
- `show`，显示某插件详细信息
- `package`，打包插件
- `publish`，发布插件
- `unpublish`，撤销已发布插件
- `version`，版本
- `help`，帮助

对于每个命令（除了 `ls`、`version`、`help`），基本格式为：

```shell
dbem <command> [-c config] [--backend backend] arguments
```

其中：

- `config`，缺省为本地目录下 config.json 。
- `backend`，缺省为配置文件中第一个 backend 。以上面的例子为例，就是 s3 。

### 后端 Provider 接口

Provider 接口抽象了与后端的交互，避免 command handler 过多介入实际的交互细节。关于接口定义，详见 [provider.ts](src/provider.ts) 文件。

### 插件存储规范

后端存储服务按以下规范组织插件：

- 根目录下存放一个记录插件组织的 `metadata` 文件，其内容是一个 json 数组文件。每个 json 的格式如下：
  - `extId`，extension id，格式：publisher.name，如：dteam.another-ext
  - `currentVersion`，当前版本
  - `icon`，图标，可选。注意，此处为图标 base64 编码后的字符串，形如："data:image/png;base64,……"。
  - `describe`，插件描述
  - `dateCreated`，插件首次发布时间
  - `lastUpdate`，插件最近发布时间
- 每个插件一个目录或项目，其名称为插件名。
- 每个插件目录内由多个版本号（符合 SemVer 规范，如 0.0.1）目录组成，每个版本目录内部的组成
  - 插件包：.vsix 文件
  - README.md，可选
  - CHANGELOG.md，可选

典型的 metadata 内容如下：

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

典型的插件目录如下：

```txt
|- my-extension
    |-  0.0.1
          |- my-extension-0.0.1.vsix
          |- READMD.md
          |- CHANGELOG.md
    |-  0.0.2
```

dbox-repo 工程下包含的 [test-data](../dbox-repo/test-data) 展示了一个期望的插件仓库目录结构和数据，可前往查看。

关于插件发布：

- 每次发布将创建一个版本目录。
- 如果同版本目录名已经存在，则原目录被覆盖：先删除目录，再创建目录。

## 工作流程

dbem 的整个工作流程如下：

- 创建插件工程，参考[这篇文档](https://code.visualstudio.com/api/get-started/your-first-extension)。
- 开发、调试、测试插件，请参考相关[插件开发文档](https://code.visualstudio.com/api)。
- 打包插件：`dbem package`。
- 配置后端服务的认证信息，请查阅相应后端的配置方法。
- 发布插件：`dbem publish`。

## 本地调试开发

- npm run compile
- npm link
- npm unlink，清理本地环境时使用

## 后端配置

目前，dbem 支持三种后端：aliyun oss、aws s3 和 dropbox。

### Aliyun OSS

注意：`dbem` 不会自动创建 bucket，必须手工在 region 下创建好 bucket，之后再按照下述方式配置。

阿里云 OSS 需要开通访问密钥（ `AccessKeyID`/`AccessKeySecret` ），为了安全起见，建议使用阿里云的子账号开启访问密钥，并限制子账号的权限，正式环境尽可能避免使用主账号的访问密钥。详细参考[权限控制概述](https://help.aliyun.com/document_detail/31867.html)。

主要配置如下:

| 参数            | 值类型 | 说明            | 范例                     |
| --------------- | ------ | --------------- | ------------------------ |
| accessKeyId     | string | AccessKeyID     | `qhxxXxXxXxxxxXXX`       |
| accessKeySecret | string | AccessKeySecret | `RkLjrXXXXxxxxxXXXXXxxx` |
| region          | string | OSS 大区        | `oss-cn-hangzhou`        |
| bucket          | string | oss bucket      | `dbox-repo`              |

> 完整配置参考 [ali-oss](https://github.com/ali-sdk/ali-oss) sdk 的[帮助文档](https://github.com/ali-sdk/ali-oss#ossoptions)

### AWS S3

注意：`debm` 不会自动创建 bucket，必须手工在 region 下创建好 bucket，之后再安装下述方式配置。

S3 需要获取认证凭证，参考官方文档中[获取凭证](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-your-credentials.html)部分。为了安全起见，正式环境尽可能使用 `IAM` 用户凭证，并且限制用户的权限。详情参考官方文档中[访问 IAM 资源所需的权限](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_permissions-required.html)。

主要配置如下:

| 参数            | 值类型 | 说明            | 范例                                       |
| --------------- | ------ | --------------- | ------------------------------------------ |
| accessKeyId     | string | AccessKeyID     | `AKIAIOSFODNN7EXAMPLE`                     |
| secretAccessKey | string | SecretAccessKey | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| region          | string | S3 存储大区     | `us-west-2`                                |
| bucket          | string | s3 bucket       | `dbox-repo`                                |

> 完整的配置参考 [S3 SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor_details)

### DropBox

使用 Dropbox 做存储需要生成 Dropbox API 访问凭证，请参考[官方文档](https://www.dropbox.com/developers/reference/getting-started#app%20console)创建 Dropbox App，`Choose the type of access you need` 选择 `App folder` 。创建 App 后，需要在 App 设置中的 `OAuth 2` 配置项中，点击 `Generated access token` 下方的 `Generate` 按钮，生成 `access token` 。

主要配置如下:

| 参数        | 值类型 | 说明                       | 范例                |
| ----------- | ------ | -------------------------- | ------------------- |
| accessToken | string | OAuth2 认证的 access token | `8zXXXXXxxxx-XXXX-` |

> 完整的配置参考 [Dropbox SDK](https://dropbox.github.io/dropbox-sdk-js/Dropbox.html#Dropbox__anchor)
