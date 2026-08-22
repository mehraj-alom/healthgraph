import uuid
from datetime import datetime, timezone
frpm sqlalchemy.orm import Session
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus, LabResult, MedicationEvent, DailyHealthEntry
from models.events import LabResult,EvidenceLink
from services.ocr.canonicalization import CanonicalizationResult,MatchStatus


class EventBuilder:
    @staticmethod
    def build_clinical_event(db: Session, patient_id: uuid.UUID,
                             document_id:uuid.UUID,canon_res: CanonicalizationResult,
                             raw_test_name:str,value:str,unit:str,ref_range:str,source_text:str,bbox:dict = None,
                             event_time:datetime = None)-> ClinicalEvent:

                        """
                        Build a ClinicalEvent object based on the provided parameters. 
                        it also creates a LabResult object and associates it with the ClinicalEvent.
                        args:
                            db (Session): SQLAlchemy session for database operations.
                            patient_id (uuid.UUID): The UUID of the patient.
                            document_id (uuid.UUID): The UUID of the document associated with the event.
                            canon_res (CanonicalizationResult): The result of canonicalization, containing standardized test name and match status.
                            raw_test_name (str): The raw test name extracted from the document.
                            value (str): The value of the lab result.
                            source_text (str): The source text from which the event was extracted.
                            bbox (dict, optional): Bounding box coordinates for the event in the document. Defaults to None.
                            event_time (datetime, optional): The time of the event. Defaults to current UTC time if not provided.
                            
                        Returns:
                            ClinicalEvent: The constructed ClinicalEvent object.
                        """
                        #check and match the canonicalization to the database
                        if canon_res.match_status == MatchStatus.AUTO_MATCH:
                                verification_status = VerificationStatus.EXTRACTED
                        else:
                                verification_status = VerificationStatus.UNVERIFIED # Review or Unknown

                        # Create a new ClinicalEvent object
                        event = ClinicalEvent(
                                event_id=uuid.uuid4(),
                                patient_id=patient_id,
                                concept_id=canon_res.concept_id,
                                event_type=EventType.LAB_RESULT,
                                source_type=SourceType.DOCUMENT,
                                verification_status=verification_status,
                                event_time=event_time if event_time else datetime.now(timezone.utc)
                        )
                        db.add(event)
                        db.flush()  # Flush to get the event_id for the LabResult

                        # Create a new LabResult object and associate it with the ClinicalEvent
                        lab_payload = LabResult(
                                event_id=event.event_id,
                                value=str(value),
                                unit=unit,
                                reference_range=ref_range,  
                        )
                        db.add(lab_payload)

                        # Evidence link to the source document
                        evidence = EvidenceLink(
                                evidence_id=uuid.uuid4(),
                                event_id=event.event_id,
                                document_id=document_id,
                                source_text=source_text or f"{raw_test_name} :{value} {unit}",
                                bounding_box=bbox
                        )
                        db.add(evidence)

                        return event