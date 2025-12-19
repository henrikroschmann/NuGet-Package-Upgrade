import * as vscode from "vscode";
import { spawn } from "child_process";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCommand(
  output: vscode.OutputChannel,
  cwd: string,
  command: string,
  args: string[]
): Promise<number> {
  return new Promise((resolve) => {
    output.appendLine(`> ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: process.env
    });

    child.stdout.on("data", (data) => output.append(data.toString()));
    child.stderr.on("data", (data) => output.append(data.toString()));

    child.on("error", (err) => {
      output.appendLine(`Command failed to start: ${err.message}`);
      resolve(1);
    });

    child.on("close", (code) => resolve(code ?? 1));
  });
}

function runCommandCapture(
  output: vscode.OutputChannel,
  cwd: string,
  command: string,
  args: string[],
  options?: { echoStdout?: boolean; echoStderr?: boolean }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    output.appendLine(`> ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (options?.echoStdout !== false) {
        output.append(text);
      }
    });
    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (options?.echoStderr !== false) {
        output.append(text);
      }
    });

    child.on("error", (err) => {
      output.appendLine(`Command failed to start: ${err.message}`);
      resolve({ code: 1, stdout, stderr });
    });

    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

type OutdatedPackage = {
  id: string;
  resolvedVersions: Set<string>;
  latestVersions: Set<string>;
  contexts: Set<string>;
};

function extractJsonPayload(text: string): string {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text;
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function parseOutdatedPackages(jsonText: string): OutdatedPackage[] {
  const data = JSON.parse(extractJsonPayload(jsonText));
  const packages = new Map<string, OutdatedPackage>();

  const projects = Array.isArray(data?.projects) ? data.projects : [];
  for (const project of projects) {
    const projectName = project?.name ?? project?.path ?? "unknown";
    const frameworks = Array.isArray(project?.frameworks) ? project.frameworks : [];

    for (const framework of frameworks) {
      const frameworkName = framework?.name ?? "unknown";
      const topLevel = Array.isArray(framework?.topLevelPackages) ? framework.topLevelPackages : [];

      for (const pkg of topLevel) {
        const id = pkg?.id ?? pkg?.name;
        if (!id || typeof id !== "string") {
          continue;
        }

        const resolved = typeof pkg?.resolvedVersion === "string" ? pkg.resolvedVersion : undefined;
        const latest = typeof pkg?.latestVersion === "string" ? pkg.latestVersion : undefined;
        const context = `${projectName} (${frameworkName})`;

        let entry = packages.get(id);
        if (!entry) {
          entry = {
            id,
            resolvedVersions: new Set<string>(),
            latestVersions: new Set<string>(),
            contexts: new Set<string>()
          };
          packages.set(id, entry);
        }

        if (resolved) {
          entry.resolvedVersions.add(resolved);
        }
        if (latest) {
          entry.latestVersions.add(latest);
        }
        entry.contexts.add(context);
      }
    }
  }

  return Array.from(packages.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureDotnetOutdated(output: vscode.OutputChannel, cwd: string): Promise<boolean> {
  const probeCode = await runCommand(output, cwd, "dotnet", ["outdated", "--version"]);
  if (probeCode === 0) {
    return true;
  }

  output.appendLine("dotnet-outdated-tool not found. Installing globally...");
  const installCode = await runCommand(output, cwd, "dotnet", [
    "tool",
    "install",
    "--global",
    "dotnet-outdated-tool"
  ]);

  return installCode === 0;
}

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand("dotnetNugetUpdate.run", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      vscode.window.showErrorMessage("Open a workspace folder to run NuGet Package Upgrade.");
      return;
    }

    const output = vscode.window.createOutputChannel("NuGet Package Upgrade");
    output.show(true);

    const cwd = folder.uri.fsPath;
    vscode.window.showInformationMessage("Running NuGet package checks...");

    const listCode = await runCommand(output, cwd, "dotnet", ["list", "package"]);
    if (listCode !== 0) {
      vscode.window.showErrorMessage("dotnet list package failed. See output for details.");
      return;
    }

    const outdatedResult = await runCommandCapture(
      output,
      cwd,
      "dotnet",
      ["list", "package", "--outdated", "--format", "json"],
      { echoStdout: false, echoStderr: false }
    );
    if (outdatedResult.code !== 0) {
      vscode.window.showErrorMessage(
        "dotnet list package --outdated --format json failed. Update your .NET SDK or see output for details."
      );
      return;
    }

    const jsonPayload = outdatedResult.stdout.trim().length
      ? outdatedResult.stdout
      : outdatedResult.stderr;

    if (!jsonPayload.trim()) {
      vscode.window.showErrorMessage("No JSON output received from dotnet list package --outdated.");
      return;
    }

    let outdatedPackages: OutdatedPackage[] = [];
    try {
      outdatedPackages = parseOutdatedPackages(jsonPayload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown parse error";
      output.appendLine("Failed to parse JSON. Raw output:");
      output.appendLine(jsonPayload);
      vscode.window.showErrorMessage(`Failed to parse outdated package list: ${message}`);
      return;
    }

    if (outdatedPackages.length === 0) {
      vscode.window.showInformationMessage("No outdated packages found.");
      return;
    }

    const items = outdatedPackages.map((pkg) => {
      const resolved =
        pkg.resolvedVersions.size === 1 ? Array.from(pkg.resolvedVersions)[0] : undefined;
      const latest = pkg.latestVersions.size === 1 ? Array.from(pkg.latestVersions)[0] : undefined;
      const description =
        resolved && latest ? `${resolved} -> ${latest}` : "multiple versions";

      return {
        label: pkg.id,
        description,
        detail: Array.from(pkg.contexts).join("; ")
      };
    });

    const selections = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select packages to upgrade"
    });

    if (!selections || selections.length === 0) {
      vscode.window.showInformationMessage("No packages selected for upgrade.");
      return;
    }

    const toolOk = await ensureDotnetOutdated(output, cwd);
    if (!toolOk) {
      vscode.window.showErrorMessage("Failed to install dotnet-outdated-tool. See output for details.");
      return;
    }

    const upgradeArgs = ["outdated", "--upgrade"];
    for (const selection of selections) {
      upgradeArgs.push("--include", selection.label);
    }

    const upgradeCode = await runCommand(output, cwd, "dotnet", upgradeArgs);
    if (upgradeCode !== 0) {
      vscode.window.showErrorMessage("dotnet outdated --upgrade failed. See output for details.");
      return;
    }

    vscode.window.showInformationMessage("NuGet packages updated.");
  });

  context.subscriptions.push(command);
}

export function deactivate() {}
