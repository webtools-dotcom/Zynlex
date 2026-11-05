# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

> **Status:** applied to the SignPath Foundation program. Until it's approved,
> ZYNLEX releases are unsigned. This page says how signing will work from the
> first signed release on.

## What gets signed

Only these files, from this repository's releases:

- `zynlex.exe`, the browser
- `zynlex-mcp.exe`, the MCP server AI coding agents connect to
- the installers: `ZYNLEX_<version>_x64-setup.exe` (NSIS) and `ZYNLEX_<version>_x64_en-US.msi`

The official repository is [github.com/webtools-dotcom/Zynlex](https://github.com/webtools-dotcom/Zynlex). Builds from forks or anywhere else are not signed by this project.

## How a release is signed

- Every signed file is built from the public source of this repository by the GitHub Actions [release workflow](.github/workflows/release.yml), started by a version tag. Nothing built on a developer's machine is ever signed.
- Each signing request is approved by hand in SignPath by an approver (below) before anything is signed.
- All of ZYNLEX's own code is under [Apache-2.0](LICENSE), and every dependency is open source. The project ships no proprietary code.

## Team

| Role | Who |
|---|---|
| Committers and reviewers | [@webtools-dotcom](https://github.com/webtools-dotcom) |
| Approvers | [@webtools-dotcom](https://github.com/webtools-dotcom) |

Everyone with write access to the repository, or with access to SignPath, uses multi-factor authentication.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

The one network call ZYNLEX makes on its own is the update check: it downloads `latest.json` from this repository's GitHub releases. It has no telemetry, no account and no analytics. The pages you open are loaded from the sites you open, as in any browser. The MCP server (`zynlex-mcp.exe`) talks only to ZYNLEX on the same machine, over a local named pipe, and to the agent that started it.
