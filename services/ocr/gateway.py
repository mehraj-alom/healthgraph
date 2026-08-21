import base64
import json
import threading
from dataclasses import dataclass
from io import BytesIO
from typing import Optional

from pdf2image import convert_from_path
from PIL import Image
from llama_cpp import Llama
from core.config import settings
from logger import logger


MODEL_PATH = settings.MODEL_PATH

# Optional if your setup exposes a separate multimodal projector.
# For LFM2.5-VL GGUF, don't automatically pass this unless your
# llama-cpp-python build/model specifically requires it.
MMPROJ_PATH = getattr(settings, "MMPROJ_PATH", None)


@dataclass
class DocumentClassification:
    is_medical: bool
    document_type: str
    type_text: Optional[str]
    bbox: Optional[list[float]]
    image_width: int
    image_height: int

    def to_dict(self) -> dict:
        return {
            "is_medical": self.is_medical,
            "document_type": self.document_type,
            "type_text": self.type_text,
            "bbox": self.bbox,
            "image_width": self.image_width,
            "image_height": self.image_height,
        }


class OCRGateway:
    """
    Lazy-loaded medical document gateway.

    Behavior:
      1. Render first PDF page.
      2. Lazy-load LFM2.5-VL-450M only on first request.
      3. Ask model:
          - medical or junk
          - document type
          - exact visible type text
          - bounding box around that type text
      4. Return bbox normalized to [0,1].
      5. Also return rendered image dimensions.

    The frontend can scale the normalized bbox to whatever size it
    displays the page at.
    """

    _llm: Optional[Llama] = None
    _model_lock = threading.Lock()
    _inference_lock = threading.Lock()

    ALLOWED_TYPES = {
        "LAB_REPORT",
        "PRESCRIPTION",
        "DISCHARGE",
        "IMAGING",
        "JUNK",
        "UNKNOWN",
    }

    CLASSIFICATION_PROMPT = """
    You are a medical document classifier.

    Analyze the FIRST PAGE of the provided document image.

    Your task has THREE parts:

    1. Decide whether the image is a genuine medical document.
    2. If it is medical, classify it into EXACTLY ONE category:
    - LAB_REPORT
    - PRESCRIPTION
    - DISCHARGE
    - IMAGING

    3. Find the visible text on the page that explicitly indicates the
    document/report type.

    Examples of type-indicating text:
    - "Laboratory Investigation Report"
    - "Lab Report"
    - "Prescription"
    - "Discharge Summary"
    - "Discharge Report"
    - "Radiology Report"
    - "MRI Report"
    - "CT Scan Report"
    - "Ultrasound Report"
    - "X-Ray Report"

    IMPORTANT:
    - Do NOT use the patient's name, doctor's name, hospital name, or date
    as the type text.
    - The bounding box must tightly surround the text indicating the
    document type.
    - Coordinates MUST be normalized to [0,1].
    - bbox format is [x1, y1, x2, y2].
    - x1/y1 is the top-left corner.
    - x2/y2 is the bottom-right corner.
    - If the document type text cannot be reliably located, return
    type_text=null and bbox=null.
    - If the document is not medical, use document_type="JUNK".
    - Never invent a bounding box.

    Return ONLY valid JSON matching this exact structure:

    {
    "is_medical": true,
    "document_type": "LAB_REPORT",
    "type_text": "Laboratory Investigation Report",
    "bbox": [0.10, 0.05, 0.70, 0.10]
    }

    For non-medical documents:

    {
    "is_medical": false,
    "document_type": "JUNK",
    "type_text": null,
    "bbox": null
    }
    """.strip()

    @classmethod
    def _extract_first_page(cls, file_path: str) -> dict:
        """
        Render the first page of a PDF and return:
          - base64 JPEG
          - image width
          - image height
        """

        images = convert_from_path(
            file_path,
            first_page=1,
            last_page=1,
            dpi=150,
        )

        if not images:
            logger.error(f"No pages found in the document: {file_path}")
            raise ValueError("No pages found in the document.")
        logger.info(f"Successfully extracted first page from: {file_path}")
        image = images[0].convert("RGB")
        width, height = image.size

        img_byte_arr = BytesIO()

        # JPEG keeps the payload considerably smaller than PNG.
        image.save(img_byte_arr,format="JPEG",quality=90,optimize=True)

        encoded = base64.b64encode(
            img_byte_arr.getvalue()
        ).decode("utf-8")

        return {
            "base64": encoded,
            "width": width,
            "height": height,
        }

    @classmethod
    def _load_model(cls) -> Llama:
        """
        Lazy-load the model exactly once per Python process.
        """

        if cls._llm is not None:
            return cls._llm

        with cls._model_lock:
            if cls._llm is not None:
                return cls._llm

            # NOTE:
            # LFM2.5-VL-450M GGUF is intended for llama.cpp multimodal
            # inference. Unlike your original LLaVA code, we don't use
            # Llava15ChatHandler here.
            #
            # If your local llama-cpp-python build requires a specific
            # multimodal/mmproj configuration for your GGUF, configure
            # that in this constructor according to that build.

            llm_kwargs = {
                "model_path": MODEL_PATH,
                "n_ctx": 2048,
                "n_gpu_layers": 0,   # CPU only
                "verbose": False,
            }

            if MMPROJ_PATH:
                llm_kwargs["mmproj"] = MMPROJ_PATH

            try:
                cls._llm = Llama(**llm_kwargs)
                logger.info(f"Successfully loaded vl model from: {MODEL_PATH}")
            except TypeError:
                # Some llama-cpp-python builds do not expose `mmproj`.
                llm_kwargs.pop("mmproj", None)
                cls._llm = Llama(**llm_kwargs)
                logger.warning(f"Loaded vl model without mmproj from: {MODEL_PATH}")
            
        return cls._llm

    @classmethod
    def _parse_model_response(
        cls,
        content: str,
        image_width: int,
        image_height: int,
    ) -> DocumentClassification:
        """
        Parse and validate model JSON.
        The model is expected to return bbox normalized to [0,1].
        """

        content = content.strip()

        # Handle accidental markdown fences.
        if content.startswith("```"):
            lines = content.splitlines()

            if lines and lines[0].startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            content = "\n".join(lines).strip()

            if content.lower().startswith("json"):
                content = content[4:].strip()

        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Model did not return valid JSON: {content}"
            ) from exc

        is_medical = bool(data.get("is_medical", False))

        document_type = str(
            data.get("document_type", "UNKNOWN")
        ).strip().upper()

        if document_type not in cls.ALLOWED_TYPES:
            document_type = "UNKNOWN"

        type_text = data.get("type_text")

        if type_text is not None:
            type_text = str(type_text).strip()

            if not type_text:
                type_text = None

        bbox = data.get("bbox")

        if bbox is not None:

            if (
                not isinstance(bbox, list)
                or len(bbox) != 4
            ):
                bbox = None
            else:
                logger.info(f"Model returned bbox: {bbox} for document_type: {document_type}")
                try:
                    bbox = [float(v) for v in bbox]
                except (TypeError, ValueError):
                    bbox = None

        # Validate normalized bbox.
        if bbox is not None:
            x1, y1, x2, y2 = bbox

            if not all(
                0.0 <= value <= 1.0
                for value in bbox
            ):
                bbox = None

            elif x2 <= x1 or y2 <= y1:
                bbox = None

        # Junk documents should not have a type box.
        if not is_medical:
            document_type = "JUNK"
            type_text = None
            bbox = None

        # If the model says medical but gives no usable type,
        # preserve the medical result but mark the type unknown.
        if is_medical and document_type == "JUNK":
            document_type = "UNKNOWN"

        return DocumentClassification(
            is_medical=is_medical,
            document_type=document_type,
            type_text=type_text,
            bbox=bbox,
            image_width=image_width,
            image_height=image_height,
        )

    @classmethod
    def _normalized_bbox_to_pixels(
        cls,
        bbox: Optional[list[float]],
        image_width: int,
        image_height: int,
    ) -> Optional[list[int]]:
        """
        Convert [0,1] bbox into pixel coordinates.
        """

        if bbox is None:
            return None

        x1, y1, x2, y2 = bbox
        logger.info(f"Converting normalized bbox {bbox} to pixels for image size ({image_width}, {image_height})")
        return [
            round(x1 * image_width),
            round(y1 * image_height),
            round(x2 * image_width),
            round(y2 * image_height),
        ]

    @classmethod
    def classify_document(
        cls,
        file_path: str,
    ) -> dict:
        """
        Main gateway method.

        Returns:

        {
            "is_medical": true,
            "document_type": "LAB_REPORT",
            "type_text": "Laboratory Investigation Report",

            # normalized bbox, [0,1]
            "bbox": [0.10, 0.05, 0.70, 0.10],

            # same bbox converted to actual pixels
            "bbox_pixels": [128, 82, 890, 165],

            "image_width": 1275,
            "image_height": 1650
        }
        """

        page = cls._extract_first_page(file_path)

        base64_image = page["base64"]
        image_width = page["width"]
        image_height = page["height"]
        llm = cls._load_model()

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": (
                                "data:image/jpeg;base64,"
                                f"{base64_image}"
                            )
                        },
                    },
                    {
                        "type": "text",
                        "text": cls.CLASSIFICATION_PROMPT,
                    },
                ],
            }
        ]

        # Protect a single CPU model from concurrent inference.
        #
        # This is especially useful if FastAPI receives multiple uploads.
        with cls._inference_lock:
            response = llm.create_chat_completion(
                messages=messages,
                max_tokens=180,
                temperature=0.0,
                top_p=1.0,
            )

        try:
            content = (
                response["choices"][0]["message"]["content"]
            )
        except (KeyError, IndexError, TypeError) as exc:
            logger.error(f"Error parsing model response: {response}")
            raise ValueError(
                f"Unexpected model response: {response}"
            ) from exc

        result = cls._parse_model_response(
            content=content,
            image_width=image_width,
            image_height=image_height,
        )

        result_dict = result.to_dict()

        # Helpful for the frontend: pixel bbox directly.
        result_dict["bbox_pixels"] = (
            cls._normalized_bbox_to_pixels(
                bbox=result.bbox,
                image_width=image_width,
                image_height=image_height,
            )
        )
        return result_dict

    @classmethod
    def unload_model(cls) -> None:
        """
        Optional manual cleanup.

        Useful if your machine is memory constrained and you want
        to release the model after a period of inactivity.
        """
        logger.info("Unloading LFM2.5-VL model from memory.")
        with cls._model_lock:
            if cls._llm is not None:
                del cls._llm
                cls._llm = None