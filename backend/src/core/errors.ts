/** Error con mensaje apto para mostrar al usuario. */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'UserError';
  }
}
