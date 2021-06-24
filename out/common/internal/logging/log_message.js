/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/import { extractImportantStackTrace } from '../stack.js';export class LogMessageWithStack extends Error {
  stackHiddenMessage = undefined;
  timesSeen = 1;

  constructor(name, ex) {
    super(ex.message);

    this.name = name;
    this.stack = ex.stack;
  }

  /** Set a flag so the stack is not printed in toJSON(). */
  setStackHidden(stackHiddenMessage) {
    this.stackHiddenMessage = stackHiddenMessage;
  }

  /** Increment the "seen x times" counter. */
  incrementTimesSeen() {
    this.timesSeen++;
  }

  toJSON() {
    let m = this.name;
    if (this.message) m += ': ' + this.message;
    if (this.stackHiddenMessage === undefined && this.stack) {
      m += '\n' + extractImportantStackTrace(this);
    } else if (this.stackHiddenMessage) {
      m += `\n  (${this.stackHiddenMessage})`;
    }
    if (this.timesSeen > 1) {
      m += `\n  (duplicated ${this.timesSeen} times (possibly non-consecutively); use ?debug=1 to show all)`;
    }
    return m;
  }}


/**
      * Returns a string, nicely indented, for debug logs.
      * This is used in the cmdline and wpt runtimes. In WPT, it shows up in the `*-actual.txt` file.
      */
export function prettyPrintLog(log) {
  return '  - ' + log.toJSON().replace(/\n/g, '\n    ');
}
//# sourceMappingURL=log_message.js.map