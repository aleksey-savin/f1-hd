const { fromJsonSchema } = require("@modelcontextprotocol/server");

const actions = ["add", "update", "delete"];
const text = { type: "string", minLength: 1, maxLength: 16000, pattern: "\\S" };
const instant = { type: "string", format: "date-time" };
const workFields = { description: text, startedAt: instant, finishedAt: instant, visitRequired: { type: "boolean" } };

function registerTicketWrites(register, mutate, timeTracking) {
  const handler = (kind, action) => async (args, caller) => {
    try {
      const result = await mutate({ kind, action, args, keyId: caller.keyId });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      if (!(error.statusCode >= 400 && error.statusCode < 500)) throw error;
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  };
  const requestId = { type: "string", pattern: "^[a-zA-Z0-9_-]{8,100}$", description: "Unique request ID. Reuse it with identical arguments on retry." };
  const num = { type: "integer", minimum: 1 };
  const expectedVersion = { type: "integer", minimum: 0, description: "Reviewed ticket version from get_ticket or the previous write." };
  const id = { type: "string", pattern: "^[a-fA-F0-9]{24}$" };
  const details = { title: { ...text, maxLength: 300 }, description: text, deadline: instant };
  const definitions = [
    ["add", { requestId, ...details, applicantId: id, companyId: id, categoryId: id }, ["description"], "Create a ticket. Defaults to the key creator as applicant."],
    ["update", { requestId, num, expectedVersion, ...details }, ["num", "expectedVersion"], "Update the title, description or deadline of an accessible ticket."],
    ["delete", { requestId, num, expectedVersion }, ["num", "expectedVersion"], "Permanently delete the reviewed ticket and clean up its linked resources."],
  ];
  for (const [action, properties, required, description] of definitions) {
    register(action + "_ticket", action[0].toUpperCase() + action.slice(1) + " ticket", description,
      fromJsonSchema({ type: "object", properties, required: ["requestId", ...required], additionalProperties: false,
        ...(action === "update" ? { anyOf: Object.keys(details).map(field => ({ required: [field] })) } : {}) }),
      handler("ticket", action), { readOnlyHint: false, destructiveHint: action !== "add", idempotentHint: true, openWorldHint: true });
  }
  for (const kind of timeTracking ? ["comment", "work"] : ["comment"]) {
    const fields = kind === "comment" ? { content: text } : workFields;
    for (const action of actions) {
      const properties = {
        num, requestId,
      };
      const required = ["num", "requestId"];
      if (action !== "add") {
        properties.id = { type: "string", pattern: "^[0-9a-fA-F]{24}$" };
        properties.revision = { type: "string", maxLength: 30, description: "Exact revision from get_ticket or the last write, including legacy." };
        required.push("id", "revision");
      }
      if (action !== "delete") Object.assign(properties, fields);
      if (action === "add") required.push(...(kind === "work" ? ["description", "startedAt", "finishedAt"] : ["content"]));
      const title = action[0].toUpperCase() + action.slice(1) + " ticket " + kind;
      register(action + "_ticket_" + kind, title, title + " as the staff member who issued this key.",
        fromJsonSchema({ type: "object", properties, required, additionalProperties: false,
          ...(action === "update" ? { anyOf: Object.keys(fields).map(field => ({ required: [field] })) } : {}) }),
        handler(kind, action), { readOnlyHint: false, destructiveHint: action !== "add", idempotentHint: true, openWorldHint: false });
    }
  }
}
module.exports = { registerTicketWrites };
