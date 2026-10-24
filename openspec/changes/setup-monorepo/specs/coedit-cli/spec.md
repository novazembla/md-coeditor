# Spec Delta

## Purpose

The `coedit` command-line binary is the single entry point for MD-Coeditor on the developer's machine: setup of a vault, start of a co-editor session, the digest for hooks, and the MCP bridge for the agent.

## ADDED Requirements

### Requirement: Runs as a command on the PATH
After installation, the `coedit` command SHALL run directly from any folder, without an explicit `node` prefix, on macOS and on Windows.

#### Scenario: Run from another folder on macOS
- **WHEN** the user runs `coedit --version` in a terminal on macOS, in a folder outside the repo
- **THEN** the command runs and exits with code 0

#### Scenario: Run from another folder on Windows
- **WHEN** the user runs `coedit --version` in Command Prompt or PowerShell on Windows, in a folder outside the repo
- **THEN** the command runs and exits with code 0

### Requirement: Show the version
`coedit --version` SHALL write the version of the installed binary to standard output as one line, and exit with code 0. The version SHALL be the same as the version of the package that built the binary.

#### Scenario: Version flag
- **WHEN** the user runs `coedit --version`
- **THEN** standard output contains exactly one line with a semantic version, for example `0.0.0`
- **AND** the exit code is 0

### Requirement: Show help
`coedit --help` SHALL write a usage text to standard output and exit with code 0. The usage text SHALL list each available subcommand with a one-line description. `coedit` without arguments SHALL show the same usage text and exit with code 0.

#### Scenario: Help flag
- **WHEN** the user runs `coedit --help`
- **THEN** standard output contains the word `Usage`
- **AND** the exit code is 0

#### Scenario: No arguments
- **WHEN** the user runs `coedit` with no arguments
- **THEN** standard output contains the same usage text as `coedit --help`
- **AND** the exit code is 0

### Requirement: Reject unknown subcommands
When the first argument is not a known subcommand or option, `coedit` SHALL write an error to standard error that names the unknown argument and tells the user to run `coedit --help`. It SHALL exit with code 2 and write nothing to standard output.

#### Scenario: Unknown subcommand
- **WHEN** the user runs `coedit frobnicate`
- **THEN** standard error contains `frobnicate` and `coedit --help`
- **AND** standard output is empty
- **AND** the exit code is 2

#### Scenario: Unknown option
- **WHEN** the user runs `coedit --frobnicate`
- **THEN** standard error contains `--frobnicate` and `coedit --help`
- **AND** the exit code is 2
