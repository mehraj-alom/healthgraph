from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI

from agents.state import GraphState
from agents.tools.anatomy_resolver import resolve_anatomy_id
from agents.tools.body_state import get_current_body_state
from agents.tools.evidence import get_document_evidence
from agents.tools.patient_graph_context import get_patient_graph_context
from agents.tools.observations import get_related_observations
from agents.tools.timeline import get_patient_timeline
from schemas.chat import AgentStructuredOutput, LLMUIAction, UIActionType

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
    return "synthesize"


def call_agent(state: GraphState):
    """Call LLM with tools to decide what to do."""
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0).bind_tools(tools)
    
    system_prompt = """You are a clinical AI assistant. You have access to tools to retrieve the patient's clinical data.
    
    When the user asks about their health data, lab reports, timeline, or anatomy:
    1. Use the appropriate tools to fetch the relevant clinical data
    2. Available tools:
       - get_patient_timeline: Get chronological health events
       - get_current_body_state: Get 3D body state with observations
       - get_related_observations: Get observations for a specific anatomy
       - get_document_evidence: Get evidence for a clinical event
       - get_patient_graph_context: Get anatomical graph context
       - resolve_anatomy_id: Resolve anatomy terms to canonical IDs
    
    Call tools as needed to answer the user's question completely."""
    
    messages = [
        SystemMessage(content=system_prompt),
        *state["messages"]
    ]
    
    response = llm.invoke(messages)
    return {"messages": [response]}


def synthesize(state: GraphState):
    """Synthesize tool results into final structured output."""
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    
    # Convert LLMUIAction to schema for structured output
    structured_llm = llm.with_structured_output(AgentStructuredOutput)
    
    system_prompt = """You are a clinical AI assistant. Synthesize the tool results into a clinical response.
    
    Rules:
    1. Provide a clear, concise clinical response in response_text
    2. Only add ui_actions when the user needs to see specific anatomy on the 3D model
    3. ui_actions must use canonical anatomy IDs (e.g., 'RIGHT_KNEE', 'HEART', 'LIVER')
    4. If no anatomy visualization is needed, leave ui_actions empty
    
    Available UI actions:
    - highlight_mesh: Highlight a structure on the 3D model
    - focus_camera: Move camera to a structure
    - open_panel: Open detail panel for a structure
    
    Only use anatomy IDs that were discussed in the conversation."""
    
    messages = [
        SystemMessage(content=system_prompt),
        *state["messages"]
    ]
    
    try:
        result = structured_llm.invoke(messages)
        return {"final_output": result}
    except Exception as e:
        # Fallback: return a simple response
        fallback = AgentStructuredOutput(
            response_text="I've reviewed the available clinical data. Please ask a more specific question if you need details about a particular finding or anatomy.",
            ui_actions=[]
        )
        return {"final_output": fallback}


workflow = StateGraph(GraphState)

workflow.add_node("agent", call_agent)
workflow.add_node("tools", ToolNode(tools))
workflow.add_node("synthesize", synthesize)

workflow.set_entry_point("agent")
workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", "synthesize": "synthesize"})
workflow.add_edge("tools", "agent")
workflow.add_edge("synthesize", END)