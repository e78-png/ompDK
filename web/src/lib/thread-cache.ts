import type { AgentMessage } from "../../../shared/api.ts";
import { buildTurns, type Step, type Turn, turnSteps } from "./turns.ts";

function sameTurn(a: Turn, b: Turn): boolean {
	if (a.key !== b.key || a.divider !== b.divider || a.user?.text !== b.user?.text || a.user?.images !== b.user?.images || a.user?.timestamp !== b.user?.timestamp) return false;
	if (a.messages.length !== b.messages.length || a.messages.some((message, i) => message !== b.messages[i])) return false;
	if ((a.commands?.length ?? 0) !== (b.commands?.length ?? 0)) return false;
	return (a.commands ?? []).every((command, i) => {
		const other = b.commands?.[i];
		return command.key === other?.key && command.command === other.command && command.text === other.text;
	});
}

/** Reuse unchanged turns after an append; snapshots and rewinds still rebuild changed content. */
export class ThreadCache {
	#turns: Turn[] = [];
	#steps = new WeakMap<Turn, Step[]>();

	update(messages: readonly AgentMessage[]): Turn[] {
		this.#turns = buildTurns(messages).map((turn, i) => {
			const previous = this.#turns[i];
			return previous && sameTurn(previous, turn) ? previous : turn;
		});
		return this.#turns;
	}

	steps(turn: Turn): Step[] {
		let steps = this.#steps.get(turn);
		if (!steps) {
			steps = turnSteps(turn);
			this.#steps.set(turn, steps);
		}
		return steps;
	}
}
