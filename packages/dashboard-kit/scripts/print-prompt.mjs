// Prints the system prompt generated from the built library (run `pnpm build` first).
import { library, promptOptions } from "../dist/index.mjs";

process.stdout.write(library.prompt(promptOptions));
