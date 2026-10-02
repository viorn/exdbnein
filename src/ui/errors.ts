/** User cancelled the run (Ctrl+C or choosing "Cancel"). */
export class CancelledError extends Error {
  constructor(message = "Installation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}
