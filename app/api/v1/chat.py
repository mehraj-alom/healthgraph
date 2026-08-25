import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Request, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from langchain_core.messages import HumanMessage

from core.db import get_db
from agents.agent_setup import medical_agent
from models.chat import ConversationThread
from models.anatomy import AnatomicalStructure, PatientBodyStateSnapshot
from schemas.chat import ChatRequest, ChatResponse, HydratedUIAction, AgentStructuredOutput
from app.api.dependencies import get_authenticated_patient_id
from logger import logger

router = APIRouter(prefix="/api/v1/chat", tags=["Agent Chat"])

def _get_agent(request: Request):
    agent = request.app.state.medical_agent
    if not agent:
        raise HTTPException(status_code=500, detail="AI Agent is not initialized.")
    return agent

@router.post("", response_model=ChatResponse)
async def process_chat(
    request: ChatRequest,
    http_request: Request,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db)
):
    medical_agent = _get_agent(http_request)

    validated_structure = None
    if request.focused_structure_id:
        validated_structure = db.execute(select(AnatomicalStructure).where(AnatomicalStructure.structure_id == request.focused_structure_id)).scalar_one_or_none()
        if not validated_structure: raise HTTPException(status_code=400, detail="Invalid focused_structure_id.")

    if request.conversation_id:
        if not db.execute(select(ConversationThread).where(ConversationThread.id == request.conversation_id, ConversationThread.patient_id == patient_id)).scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Conversation access denied.")
        conversation_id = request.conversation_id
    else:
        conversation_id = uuid.uuid4()
        db.add(ConversationThread(id=conversation_id, patient_id=patient_id))
        db.commit()

    user_prompt = request.message
    if validated_structure:
        user_prompt += f"\n[Context: User tapped {validated_structure.display_name} ({validated_structure.structure_id})]"

    config = {"configurable": {"session_patient_id": str(patient_id), "thread_id": str(conversation_id)}, "recursion_limit": 15}

    try:
        # Force final_output to None to clear stale checkpoints
        graph_result = await medical_agent.ainvoke({"messages": [HumanMessage(content=user_prompt)], "final_output": None}, config=config)
    except Exception as e:
        logger.error(f"Agent execution failed: {e}")
        raise HTTPException(status_code=500, detail="Clinical processing error.")

    final_output: AgentStructuredOutput = graph_result.get("final_output")
    hydrated_actions = []
    
    if final_output and final_output.ui_actions:
        for action in final_output.ui_actions:
            if not action.structure_id: continue
            
            # Authoritative Server UI Hydration
            struct_data = db.execute(select(AnatomicalStructure).where(AnatomicalStructure.structure_id == action.structure_id)).scalar_one_or_none()
            if struct_data and struct_data.mesh_node_name:
                status_data = db.execute(select(PatientBodyStateSnapshot.visual_status).where(PatientBodyStateSnapshot.patient_id == patient_id, PatientBodyStateSnapshot.structure_id == action.structure_id)).scalar_one_or_none()
                hydrated_actions.append(HydratedUIAction(
                    action_type=action.action_type, structure_id=action.structure_id,
                    mesh_node_name=struct_data.mesh_node_name, visual_status=status_data.value if status_data else "normal"
                ))

    return ChatResponse(
        conversation_id=conversation_id,
        response_text=final_output.response_text if final_output else "Processing incomplete.",
        ui_actions=hydrated_actions
    )