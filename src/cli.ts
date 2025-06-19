import yargs, { ArgumentsCamelCase } from "yargs"
import { hideBin } from "yargs/helpers"
import {
  installRelativeDeps,
  watchRelativeDeps,
  initRelativeDeps,
  addRelativeDeps,
} from "./index.js"

interface Arguments {
  dev?: boolean
  D?: boolean
  "save-dev"?: boolean
  script?: string
  S?: string
  paths?: string[]
  force?: boolean
  f?: boolean
  clean?: boolean
  c?: boolean
  verbose?: boolean
  v?: boolean
}

yargs(hideBin(process.argv))
  .usage("Usage: $0 <command> [options]")
  .version()
  .help()
  .command(
    "*",
    "Install relative deps",
    (yargs) => yargs,
    (argv: ArgumentsCamelCase<Arguments>) =>
      installRelativeDeps({
        force: argv.force || argv.f,
        clean: argv.clean || argv.c,
        verbose: argv.verbose || argv.v,
      })
  )
  .command(
    "watch",
    "Watch relative deps and install on change",
    (yargs) => yargs,
    watchRelativeDeps
  )
  .command(
    "init",
    "Initialize relative-deps",
    (yargs) => yargs,
    (argv: ArgumentsCamelCase<Arguments>) =>
      initRelativeDeps({ script: argv.script })
  )
  .command(
    "add [paths...]",
    "Add path as relative dependencies",
    (yargs) => yargs,
    (argv: ArgumentsCamelCase<Arguments>) =>
      addRelativeDeps({
        paths: argv.paths,
        dev: argv.dev || argv.D || argv["save-dev"],
        script: argv.script,
      })
  )
  .option("D", {
    alias: ["dev", "save-dev"],
    description: "Save as dev dependency",
    default: false,
    type: "boolean",
  })
  .option("S", {
    alias: ["script"],
    description: "Script for relative-deps",
    default: "prepare",
    type: "string",
  })
  .option("f", {
    alias: ["force"],
    description: "Force update all relative dependencies, ignoring cache",
    default: false,
    type: "boolean",
  })
  .option("c", {
    alias: ["clean"],
    description: "Clean all caches before installing",
    default: false,
    type: "boolean",
  })
  .option("v", {
    alias: ["verbose"],
    description: "Show detailed output",
    default: false,
    type: "boolean",
  })
  .parse()
