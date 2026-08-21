EXTRACTION_SCHEMA = {
  "type": "object",
  "properties": {
    "document": {
      "description": "The complete medical or laboratory report and its extracted clinical information.",
      "x-alternativeNames": [
        "Medical Report",
        "Clinical Report",
        "Laboratory Report",
        "Patient Report"
      ],
      "type": "object",
      "properties": {
        "document_id": {
          "description": "Unique identifier of the medical document or report.",
          "x-alternativeNames": [
            "Document ID",
            "Report ID",
            "Accession ID"
          ],
          "type": "string"
        },
        "document_type": {
          "description": "The type of medical document, such as laboratory report, pathology report, radiology report, microbiology report, or clinical report.",
          "x-alternativeNames": [
            "Report Type",
            "Medical Document Type",
            "Document Category"
          ],
          "type": "string"
        },
        "title": {
          "description": "The title or heading of the medical report.",
          "x-alternativeNames": [
            "Report Title",
            "Document Title",
            "Study Title"
          ],
          "type": "string"
        },
        "total_pages": {
          "description": "Total number of pages in the source document.",
          "x-alternativeNames": [
            "Page Count",
            "Number of Pages"
          ],
          "type": "integer"
        },
        "language": {
          "description": "Language used in the medical document.",
          "x-alternativeNames": [
            "Report Language",
            "Document Language"
          ],
          "type": "string"
        },
        "source_file": {
          "description": "Original file name or source document reference.",
          "x-alternativeNames": [
            "File Name",
            "Source Document",
            "Original File"
          ],
          "type": "string"
        },
        "report_status": {
          "description": "Current status of the report, such as preliminary, final, amended, or cancelled.",
          "x-alternativeNames": [
            "Report State",
            "Result Status",
            "Document Status"
          ],
          "type": "string"
        },
        "patient": {
          "description": "Patient identification and demographic information.",
          "x-alternativeNames": [
            "Patient Details",
            "Patient Information",
            "Demographics"
          ],
          "type": "object",
          "properties": {
            "name": {
              "description": "Full name of the patient.",
              "x-alternativeNames": [
                "Patient Name",
                "Name"
              ],
              "type": "string"
            },
            "patient_id": {
              "description": "Unique patient identifier used by the healthcare organisation.",
              "x-alternativeNames": [
                "Patient ID",
                "Patient Number",
                "Hospital ID"
              ],
              "type": "string"
            },
            "nhs_or_mrn": {
              "description": "National health identifier or medical record number when present.",
              "x-alternativeNames": [
                "MRN",
                "Medical Record Number",
                "NHS Number",
                "Health ID"
              ],
              "type": "string"
            },
            "date_of_birth": {
              "description": "Patient date of birth.",
              "x-alternativeNames": [
                "DOB",
                "Birth Date",
                "Date of Birth"
              ],
              "format": "YYYY-MM-DD",
              "type": "string"
            },
            "age": {
              "description": "Patient age as stated in the report.",
              "x-alternativeNames": [
                "Patient Age",
                "Age"
              ],
              "type": "string"
            },
            "sex": {
              "description": "Patient sex or gender as recorded in the report.",
              "x-alternativeNames": [
                "Sex",
                "Gender"
              ],
              "type": "string"
            },
            "address": {
              "description": "Patient address when present.",
              "x-alternativeNames": [
                "Address",
                "Patient Address"
              ],
              "type": "string"
            },
            "pregnancy_status": {
              "description": "Pregnancy status when clinically relevant or reported.",
              "x-alternativeNames": [
                "Pregnancy",
                "Pregnant Status"
              ],
              "type": "string"
            }
          }
        },
        "requester": {
          "description": "Healthcare professional or organisation that requested the test or report.",
          "x-alternativeNames": [
            "Referrer",
            "Requesting Clinician",
            "Ordering Provider"
          ],
          "type": "object",
          "properties": {
            "name": {
              "description": "Name of the requesting healthcare professional.",
              "x-alternativeNames": [
                "Requester Name",
                "Referrer Name",
                "Ordering Clinician"
              ],
              "type": "string"
            },
            "role": {
              "description": "Professional role of the requester.",
              "x-alternativeNames": [
                "Requester Role",
                "Clinician Role"
              ],
              "type": "string"
            },
            "organisation": {
              "description": "Organisation or healthcare facility of the requester.",
              "x-alternativeNames": [
                "Organisation",
                "Hospital",
                "Healthcare Provider"
              ],
              "type": "string"
            },
            "department": {
              "description": "Department associated with the request.",
              "x-alternativeNames": [
                "Department",
                "Unit",
                "Clinic"
              ],
              "type": "string"
            },
            "contact": {
              "description": "Contact information for the requester.",
              "x-alternativeNames": [
                "Contact",
                "Phone",
                "Email"
              ],
              "type": "string"
            }
          }
        },
        "clinical_information": {
          "description": "Clinical history, symptoms, indication, diagnosis, or reason for the investigation.",
          "x-alternativeNames": [
            "Clinical History",
            "Clinical Details",
            "Indication",
            "Reason for Test"
          ],
          "type": "string"
        },
        "specimens": {
          "description": "Biological specimens or samples associated with the report.",
          "x-alternativeNames": [
            "Samples",
            "Specimen Details",
            "Sample Information"
          ],
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "specimen_id": {
                "description": "Identifier assigned to the specimen.",
                "x-alternativeNames": [
                  "Specimen ID",
                  "Sample ID",
                  "Accession Number"
                ],
                "type": "string"
              },
              "type": {
                "description": "Type of specimen collected.",
                "x-alternativeNames": [
                  "Specimen Type",
                  "Sample Type"
                ],
                "type": "string"
              },
              "site": {
                "description": "Anatomical site or source from which the specimen was collected.",
                "x-alternativeNames": [
                  "Collection Site",
                  "Anatomical Site",
                  "Source"
                ],
                "type": "string"
              },
              "collection_date": {
                "description": "Date the specimen was collected.",
                "x-alternativeNames": [
                  "Collection Date",
                  "Sample Date"
                ],
                "format": "YYYY-MM-DD",
                "type": "string"
              },
              "collection_time": {
                "description": "Time the specimen was collected.",
                "x-alternativeNames": [
                  "Collection Time",
                  "Sample Time"
                ],
                "type": "string"
              },
              "received_date": {
                "description": "Date the laboratory received the specimen.",
                "x-alternativeNames": [
                  "Received Date",
                  "Laboratory Receipt Date"
                ],
                "format": "YYYY-MM-DD",
                "type": "string"
              },
              "condition": {
                "description": "Condition or quality of the specimen when received.",
                "x-alternativeNames": [
                  "Specimen Condition",
                  "Sample Condition"
                ],
                "type": "string"
              },
              "adequacy": {
                "description": "Whether the specimen was adequate or suitable for testing.",
                "x-alternativeNames": [
                  "Specimen Adequacy",
                  "Sample Adequacy",
                  "Adequacy"
                ],
                "type": "string"
              }
            }
          }
        },
        "sections": {
          "description": "Individual clinical or laboratory sections within the medical report.",
          "x-alternativeNames": [
            "Report Sections",
            "Test Sections",
            "Laboratory Disciplines"
          ],
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "section_id": {
                "description": "Unique identifier for the report section.",
                "x-alternativeNames": [
                  "Section ID",
                  "Section Identifier"
                ],
                "type": "string"
              },
              "section_type": {
                "description": "Clinical discipline or type of section, such as haematology, biochemistry, microbiology, pathology, genetics, immunology, endocrinology, coagulation, toxicology, transfusion, or clinical comments.",
                "x-alternativeNames": [
                  "Section Type",
                  "Discipline",
                  "Laboratory Department"
                ],
                "type": "string"
              },
              "section_title": {
                "description": "Displayed title of the section.",
                "x-alternativeNames": [
                  "Section Title",
                  "Panel Title",
                  "Test Group"
                ],
                "type": "string"
              },
              "specimen_id": {
                "description": "Specimen associated with this section.",
                "x-alternativeNames": [
                  "Specimen ID",
                  "Sample ID"
                ],
                "type": "string"
              },
              "clinical_comment": {
                "description": "Clinical comment associated with the section.",
                "x-alternativeNames": [
                  "Clinical Comment",
                  "Clinical Note",
                  "Laboratory Comment"
                ],
                "type": "string"
              },
              "results": {
                "description": "Individual laboratory or diagnostic test results.",
                "x-alternativeNames": [
                  "Test Results",
                  "Results",
                  "Measurements"
                ],
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "test_name": {
                      "description": "Name of the laboratory or diagnostic test.",
                      "x-alternativeNames": [
                        "Test Name",
                        "Analyte",
                        "Investigation"
                      ],
                      "type": "string"
                    },
                    "test_code": {
                      "description": "Laboratory or system code for the test.",
                      "x-alternativeNames": [
                        "Test Code",
                        "Lab Code",
                        "Analyte Code"
                      ],
                      "type": "string"
                    },
                    "result": {
                      "description": "Reported numeric, textual, qualitative, or semi-quantitative result.",
                      "x-alternativeNames": [
                        "Result",
                        "Value",
                        "Finding"
                      ],
                      "oneOf": [
                        { "type": "number" },
                        { "type": "string" },
                        { "type": "boolean" }
                      ]
                    },
                    "unit": {
                      "description": "Unit associated with the result.",
                      "x-alternativeNames": [
                        "Unit",
                        "Measurement Unit"
                      ],
                      "type": "string"
                    },
                    "reference_range": {
                      "description": "Reference interval or normal range provided by the report.",
                      "x-alternativeNames": [
                        "Reference Range",
                        "Normal Range",
                        "Expected Range"
                      ],
                      "type": "string"
                    },
                    "reference_low": {
                      "description": "Lower numeric limit of the reference range when available.",
                      "x-alternativeNames": [
                        "Reference Low",
                        "Lower Limit"
                      ],
                      "type": "number"
                    },
                    "reference_high": {
                      "description": "Upper numeric limit of the reference range when available.",
                      "x-alternativeNames": [
                        "Reference High",
                        "Upper Limit"
                      ],
                      "type": "number"
                    },
                    "flag": {
                      "description": "Abnormality indicator assigned by the laboratory.",
                      "x-alternativeNames": [
                        "Flag",
                        "Abnormal Flag",
                        "H/L Flag"
                      ],
                      "type": "string"
                    },
                    "critical": {
                      "description": "Indicates whether the result is explicitly identified as critical or urgent.",
                      "x-alternativeNames": [
                        "Critical Result",
                        "Critical Value",
                        "Urgent Result"
                      ],
                      "type": "boolean"
                    },
                    "interpretation": {
                      "description": "Interpretation or meaning of the individual result when stated in the report.",
                      "x-alternativeNames": [
                        "Interpretation",
                        "Result Interpretation"
                      ],
                      "type": "string"
                    },
                    "method": {
                      "description": "Analytical or diagnostic method used to obtain the result.",
                      "x-alternativeNames": [
                        "Method",
                        "Test Method",
                        "Technique"
                      ],
                      "type": "string"
                    },
                    "previous_result": {
                      "description": "Previous result provided for comparison.",
                      "x-alternativeNames": [
                        "Previous Result",
                        "Prior Result",
                        "Historical Result"
                      ],
                      "type": "string"
                    },
                    "previous_date": {
                      "description": "Date of the previous result.",
                      "x-alternativeNames": [
                        "Previous Date",
                        "Prior Date"
                      ],
                      "format": "YYYY-MM-DD",
                      "type": "string"
                    },
                    "page_number": {
                      "description": "Page on which the result appears in the source document.",
                      "x-alternativeNames": [
                        "Page",
                        "Page Number",
                        "Source Page"
                      ],
                      "type": "integer"
                    },
                    "source_text": {
                      "description": "Exact source text supporting the extracted result.",
                      "x-alternativeNames": [
                        "Source Text",
                        "Evidence",
                        "Original Text"
                      ],
                      "type": "string"
                    },
                    "confidence": {
                      "description": "Confidence score for the extracted result.",
                      "x-alternativeNames": [
                        "Confidence",
                        "Extraction Confidence"
                      ],
                      "type": "number"
                    }
                  }
                }
              },
              "organisms": {
                "description": "Microorganisms identified in a microbiology or culture report.",
                "x-alternativeNames": [
                  "Organisms",
                  "Culture Results",
                  "Microorganisms"
                ],
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "organism": {
                      "description": "Name of the identified organism.",
                      "x-alternativeNames": [
                        "Organism",
                        "Microorganism",
                        "Pathogen"
                      ],
                      "type": "string"
                    },
                    "quantity": {
                      "description": "Quantity or growth level of the organism.",
                      "x-alternativeNames": [
                        "Quantity",
                        "Growth",
                        "Colony Count"
                      ],
                      "type": "string"
                    },
                    "significance": {
                      "description": "Clinical significance of the identified organism.",
                      "x-alternativeNames": [
                        "Significance",
                        "Clinical Significance"
                      ],
                      "type": "string"
                    },
                    "susceptibility": {
                      "description": "Antimicrobial susceptibility results for the organism.",
                      "x-alternativeNames": [
                        "Antibiotic Sensitivity",
                        "Susceptibility Testing",
                        "Sensitivity"
                      ],
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "antibiotic": {
                            "description": "Antimicrobial agent tested.",
                            "x-alternativeNames": [
                              "Antibiotic",
                              "Antimicrobial"
                            ],
                            "type": "string"
                          },
                          "result": {
                            "description": "Susceptibility interpretation such as susceptible, intermediate, or resistant.",
                            "x-alternativeNames": [
                              "Sensitivity Result",
                              "Susceptibility Result",
                              "S/I/R"
                            ],
                            "type": "string"
                          },
                          "mic": {
                            "description": "Minimum inhibitory concentration when reported.",
                            "x-alternativeNames": [
                              "MIC",
                              "Minimum Inhibitory Concentration"
                            ],
                            "type": "string"
                          }
                        }
                      }
                    }
                  }
                }
              },
              "diagnosis": {
                "description": "Diagnosis or diagnostic conclusion stated in the section.",
                "x-alternativeNames": [
                  "Diagnosis",
                  "Diagnostic Conclusion",
                  "Final Diagnosis"
                ],
                "type": "string"
              },
              "microscopy": {
                "description": "Microscopic examination findings.",
                "x-alternativeNames": [
                  "Microscopy",
                  "Microscopic Findings"
                ],
                "type": "string"
              },
              "macroscopy": {
                "description": "Gross or visual examination findings.",
                "x-alternativeNames": [
                  "Macroscopy",
                  "Gross Description",
                  "Gross Findings"
                ],
                "type": "string"
              },
              "grading_or_staging": {
                "description": "Tumour grade, disease stage, or other clinical grading information.",
                "x-alternativeNames": [
                  "Grade",
                  "Stage",
                  "Grading",
                  "Staging"
                ],
                "type": "string"
              },
              "comments": {
                "description": "Additional comments or conclusions associated with the section.",
                "x-alternativeNames": [
                  "Comments",
                  "Notes",
                  "Remarks"
                ],
                "type": "string"
              }
            }
          }
        },
        "pages": {
          "description": "Page-level information used to preserve document structure and extraction traceability.",
          "x-alternativeNames": [
            "Pages",
            "Page Details",
            "Document Pages"
          ],
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "page_number": {
                "description": "Page number in the source document.",
                "x-alternativeNames": [
                  "Page",
                  "Page Number"
                ],
                "type": "integer"
              },
              "page_type": {
                "description": "Type or purpose of the page.",
                "x-alternativeNames": [
                  "Page Type",
                  "Page Category"
                ],
                "type": "string"
              },
              "header_text": {
                "description": "Header text appearing on the page.",
                "x-alternativeNames": [
                  "Header",
                  "Page Header"
                ],
                "type": "string"
              },
              "footer_text": {
                "description": "Footer text appearing on the page.",
                "x-alternativeNames": [
                  "Footer",
                  "Page Footer"
                ],
                "type": "string"
              },
              "section_ids": {
                "description": "Sections present on the page.",
                "x-alternativeNames": [
                  "Section IDs",
                  "Sections"
                ],
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "page_text": {
                "description": "Text extracted from the page.",
                "x-alternativeNames": [
                  "Page Text",
                  "OCR Text",
                  "Extracted Text"
                ],
                "type": "string"
              },
              "tables": {
                "description": "Tables detected on the page.",
                "x-alternativeNames": [
                  "Tables",
                  "Result Tables",
                  "Data Tables"
                ],
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "table_title": {
                      "description": "Title or heading of the table.",
                      "x-alternativeNames": [
                        "Table Title",
                        "Table Name"
                      ],
                      "type": "string"
                    },
                    "headers": {
                      "description": "Column headers of the table.",
                      "x-alternativeNames": [
                        "Headers",
                        "Column Names"
                      ],
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "rows": {
                      "description": "Rows and cell values contained in the table.",
                      "x-alternativeNames": [
                        "Rows",
                        "Table Data",
                        "Records"
                      ],
                      "type": "array",
                      "items": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "alerts": {
          "description": "Clinically important, abnormal, critical, urgent, or safety-relevant findings identified in the report.",
          "x-alternativeNames": [
            "Critical Alerts",
            "Abnormal Findings",
            "Warnings",
            "Critical Results"
          ],
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "message": {
                "description": "Description of the clinical alert or important finding.",
                "x-alternativeNames": [
                  "Alert",
                  "Warning",
                  "Critical Message"
                ],
                "type": "string"
              },
              "severity": {
                "description": "Severity of the alert.",
                "x-alternativeNames": [
                  "Severity",
                  "Urgency",
                  "Priority"
                ],
                "type": "string"
              },
              "page_number": {
                "description": "Page containing the alert.",
                "x-alternativeNames": [
                  "Page",
                  "Source Page"
                ],
                "type": "integer"
              },
              "related_test": {
                "description": "Test or result associated with the alert.",
                "x-alternativeNames": [
                  "Related Test",
                  "Associated Result"
                ],
                "type": "string"
              }
            }
          }
        },
        "laboratory": {
          "description": "Laboratory or healthcare facility responsible for producing the report.",
          "x-alternativeNames": [
            "Laboratory",
            "Lab",
            "Testing Facility"
          ],
          "type": "object",
          "properties": {
            "name": {
              "description": "Name of the laboratory.",
              "x-alternativeNames": [
                "Laboratory Name",
                "Lab Name"
              ],
              "type": "string"
            },
            "department": {
              "description": "Laboratory department responsible for the report.",
              "x-alternativeNames": [
                "Department",
                "Lab Department"
              ],
              "type": "string"
            },
            "laboratory_id": {
              "description": "Identifier of the laboratory.",
              "x-alternativeNames": [
                "Laboratory ID",
                "Lab ID"
              ],
              "type": "string"
            },
            "accreditation": {
              "description": "Laboratory accreditation information.",
              "x-alternativeNames": [
                "Accreditation",
                "Accreditation Details"
              ],
              "type": "string"
            }
          }
        },
        "authorisation": {
          "description": "Report verification, authorisation, and sign-off information.",
          "x-alternativeNames": [
            "Authorisation",
            "Verification",
            "Sign-off"
          ],
          "type": "object",
          "properties": {
            "reported_by": {
              "description": "Person who reported or prepared the result.",
              "x-alternativeNames": [
                "Reported By",
                "Reporting Scientist",
                "Author"
              ],
              "type": "string"
            },
            "verified_by": {
              "description": "Person who verified the report or result.",
              "x-alternativeNames": [
                "Verified By",
                "Verifier",
                "Reviewer"
              ],
              "type": "string"
            },
            "authorised_date": {
              "description": "Date the report was authorised.",
              "x-alternativeNames": [
                "Authorised Date",
                "Approval Date"
              ],
              "format": "YYYY-MM-DD",
              "type": "string"
            },
            "authorised_time": {
              "description": "Time the report was authorised.",
              "x-alternativeNames": [
                "Authorised Time",
                "Approval Time"
              ],
              "type": "string"
            }
          }
        }
      }
    }
  }
}