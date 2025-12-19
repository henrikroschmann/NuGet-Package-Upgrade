# NuGet Package Upgrade

Select outdated NuGet packages in VS Code and upgrade only what you choose.

## Features

- Runs `dotnet list package` for a baseline inventory.
- Pulls outdated packages with `dotnet list package --outdated --format json`.
- Shows a native multi-select picker with version deltas and project/framework context.
- Ensures `dotnet-outdated-tool` is installed (`dotnet tool install --global dotnet-outdated-tool`).
- Upgrades selected packages with `dotnet outdated --upgrade --include <package>`.

## Requirements

- .NET SDK in PATH.
- The command operates on the first workspace folder.

## Usage

1) Open a workspace containing your `.sln` or `.csproj` files.  
2) Run the command: `NuGet Package Upgrade: Select and Upgrade Packages`.  
3) Pick the packages to upgrade and confirm.

Output appears in the “NuGet Package Upgrade” Output channel.

## Development

1) `npm install`  
2) Run the “Run Extension” debug configuration (F5).

## Packaging

```
npm install -g @vscode/vsce
npm run compile
vsce package
```

Place your logo at `images/logo.png` before publishing.
