#!/usr/bin/env node
import { APP_NAME } from "./config.ts";
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { buildKosRpcArgs } from "./kos/rpc-args.ts";
import { main } from "./main.ts";

process.title = `${APP_NAME}-rpc`;
process.env.PI_CODING_AGENT = "true";
process.env.KOS_AGENT = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

main(buildKosRpcArgs(process.argv.slice(2)));
