/** An error that carries the HTTP status the client should see. */
export class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}
