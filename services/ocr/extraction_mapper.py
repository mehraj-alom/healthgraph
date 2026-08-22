import uuid
from datetime import datetime, timezone
from logger import logger
from sqlalchemy.orm import Session
from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus, LabResult, MedicationEvent, DailyHealthEntry
from models.events import LabResult,EvidenceLink,RawExtractionData, Document
from services.ocr.canonicalization import CanonicalizationResult, Canonicalizer,MatchStatus
from sqlalchemy import select



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
                        match_status = getattr(canon_res, "match_status", getattr(canon_res, "status"))
                        if match_status == MatchStatus.AUTO_MATCH:
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


event_builder = EventBuilder()

class ExtractionMapper:
    @staticmethod
    def map_to_timeline(db: Session, document_id :uuid.UUID) ->int:
        """parse the raw extraction data and map it to the timeline events in the database
        Args:
            db (Session): SQLAlchemy session for database operations.
            document_id (uuid.UUID): The UUID of the document whose extraction data is to be mapped.
        Returns:
            int: The number of events successfully mapped to the timeline.
        """
        raw_record = db.scaler(select(RawExtractionData).where(RawExtractionData.document_id == document_id))
        document = db.scaler(select(Document).where(Document.document_id == document_id))

        if not raw_record or not raw_record.extraction or not document:
                logger.warning(f"No valid extraction data found for document {document_id}.")
                return 0
        
        doc_json = raw_record.extraction.get("document", {})
        sections = doc_json.get("sections", [])
        events_created = 0

        for section in sections:
             results = section.get("results", [])

             for result in results:
                raw_test_name = result.get("test_name", "")
                value = result.get("result", "")
                if not raw_test_name or not value:
                        logger.warning(f"Missing test name or value in result: {result}. Skipping.")
                        continue
                canon_res = Canonicalizer.resolve_concept(db, raw_term=raw_test_name)

                unit = result.get("unit", "")
                ref_range = result.get("reference_range", "")
                source_text = result.get("source_text", "")

                #Note : bbox will be added later now passed asnone 
                
                #Materialize the event time if available, else use current UTC time
                event_builder.build_clinical_event(
                       db=db,
                       patient_id=document.patient_id,
                       document_id=document.document_id,
                       canon_res=canon_res,
                       raw_test_name=raw_test_name,
                       value=value,
                       unit=unit,
                       ref_range=ref_range,     
                       source_text=source_text,
                       bbox=None,  # Placeholder for bounding box, to be implemented later
                )
                events_created += 1
        db.commit()
        logger.info(f"Successfully mapped {events_created} events for document {document_id}.")
        return events_created
          
                      

