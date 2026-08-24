from typing import Annotated, Sequence, Optional
from typing_extensions import TypedDict
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from schemas.chat import AgentStructuredOutput
from agents.tools.anatomy_resolver import resolve_anatomy_id
from agents.tools.body_state import get_current_body_state
from agents.tools.graph_context import get_anatomy_context
from agents.tools.patient_graph_context import get_patient_graph_context
from agents.tools.observations import get_related_observations
from agents.tools.evidence import get_document_evidence
from agents.tools.timeline import get_patient_timeline
from agents.state import GraphState

SYSTEM_PROMPT = """You are a clinical reasoning assistant.
OPERATING ENVELOPE & STRICT POLICIES:
1. Never invent clinical facts.
2. Never infer a diagnosis from absence of data.
3. Resolve natural-language anatomy before anatomy queries (`resolve_anatomy_id`).
4. Use graph context (`get_patient_graph_context`) before expensive evidence retrieval.
5. Treat PostgreSQL as authoritative for clinical fields.
6. Treat Neo4j as authoritative for topology/provenance.
7. Treat Qdrant as evidence retrieval, not clinical truth.
8. Never expose another patient's data.
9. Never fabricate UI actions or anatomy mappings.
10. If evidence is insufficient, explicitly say so.
"""

CLINICAL_TOOLS = [resolve_anatomy_id, get_current_body_state, get_anatomy_context, get_patient_graph_context, get_related_observations, get_document_evidence, get_patient_timeline]

llm = ChatOpenAI(model="gpt-4o", temperature=0)
llm_with_tools = llm.bind_tools(CLINICAL_TOOLS)
structured_llm = llm.with_structured_output(AgentStructuredOutput)

async def call_reasoning_agent(state: GraphState):
    messages = state["messages"]
    if not messages or not isinstance(messages[0], SystemMessage):
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)
    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}

async def synthesize_output(state: GraphState):
    synthesis_prompt = "Based on the data above, produce the final response and requested UI actions."
    final_structured = await structured_llm.ainvoke(list(state["messages"]) + [SystemMessage(content=synthesis_prompt)])
    return {"final_output": final_structured}

def route_next_step(state: GraphState):
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"
    return "synthesize"

workflow = StateGraph(GraphState)
workflow.add_node("agent", call_reasoning_agent)
workflow.add_node("tools", ToolNode(CLINICAL_TOOLS))
workflow.add_node("synthesize", synthesize_output)
workflow.add_edge(START, "agent")
workflow.add_conditional_edges("agent", route_next_step, {"tools": "tools", "synthesize": "synthesize"})
workflow.add_edge("tools", "agent")
workflow.add_edge("synthesize", END)