/** Пользователь прервал работу (Ctrl+C или выбор «Отмена»). */
export class CancelledError extends Error {
  constructor(message = "Установка отменена") {
    super(message);
    this.name = "CancelledError";
  }
}
