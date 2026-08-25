from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from agents.state import GraphState
from agents.tools.anatomy_resolver import resolve_anatomy_id
from agents.tools.body_state import get_current_body_state
from agents.tools.evidence import get_document_evidence
from agents.tools.patient_graph_context import get_patient_graph_context
from agents.tools.observations import get_related_observations
from agents.tools.timeline import get_patient_timeline

tools = [
    resolve_anatomy_id,
    get_current_body_state,
    get_document_evidence,
    get_patient_graph_context,
    get_related_observations,
    get_patient_timeline,
]


def should_continue(state: GraphState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return END


workflow = StateGraph(GraphState)

workflow.add_node("agent", lambda state: state)
workflow.add_node("tools", ToolNode(tools))

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
workflow.add_edge("tools", "agent")
