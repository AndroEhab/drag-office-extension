const fs = require('fs');
const path = require('path');

/**
 * Load a browser-global IIFE module for use in Node tests.
 * Reads the file, replaces `const <globalName> =` with `global.<globalName> =`,
 * evaluates it, and returns the global.
 *
 * @param {string} filePath  Relative path from the caller's directory
 * @param {string} globalName  The variable name the IIFE assigns to (e.g. 'Cleaner')
 * @param {string} [basePath=__dirname]  Base directory for resolving filePath
 * @returns {*} The exported module object
 */
function loadModule(filePath, globalName, basePath) {
  const base = basePath || __dirname;
  let code = fs.readFileSync(path.resolve(base, filePath), 'utf-8');
  code = code.replace(`const ${globalName} =`, `global.${globalName} =`);
  // Use indirect eval so the code runs in the global scope (where jsdom globals live)
  (0, eval)(code);
  return global[globalName];
}

module.exports = { loadModule };
