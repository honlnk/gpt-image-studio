#!/usr/bin/env node
import { bootstrapDataDir } from "./startupBootstrap.js";

bootstrapDataDir(process.argv.slice(2));
await import("./cli.js");
