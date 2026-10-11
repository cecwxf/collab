/**
 * `/collab …` grammar for the dsh command surface (dsh-commands): pure parsing, no I/O.
 * dsh hands the command everything after `/collab` verbatim as rawInput.
 */
export type CollabCommand = {
    op: "help";
} | {
    op: "status";
} | {
    op: "create";
    name?: string;
    description?: string;
    tags: string[];
    public: boolean;
} | {
    op: "join";
    invite: string;
} | {
    op: "join-result";
    index: number;
} | {
    op: "search";
    query?: string;
    tag?: string;
} | {
    op: "rooms";
} | {
    op: "use";
    room: string;
} | {
    op: "invite";
} | {
    op: "members";
} | {
    op: "say";
    text: string;
    mentions: string[];
} | {
    op: "task";
    title: string;
    body?: string;
    assignee?: string;
} | {
    op: "log";
    limit: number;
} | {
    op: "leave";
} | {
    op: "error";
    message: string;
};
export declare function extractMentions(text: string): string[];
export declare const HELP: string;
export declare function parseCollabCommand(rawInput: string): CollabCommand;
//# sourceMappingURL=commands.d.ts.map