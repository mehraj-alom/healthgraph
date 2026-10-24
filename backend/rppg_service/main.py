"""
rPPG Backend Inference Service
FastAPI service that runs PhysFormer ONNX model for face rPPG inference.
Replaces on-device inference (onnxruntime-react-native + native module).
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration (must match frontend contract exactly)
MODEL_PATH = os.getenv("RPPG_MODEL_PATH", "/app/physformer_rppg_fp16.onnx")
INPUT_NAME = "video"
OUTPUT_NAME = "rppg"
EXPECTED_INPUT_SHAPE = (1, 3, 160, 128, 128)  # [batch, channels, frames, height, width]
EXPECTED_OUTPUT_SHAPE = (1, 160)
CHANNEL_ORDER = "BGR"
NORMALIZE_MEAN = 127.5
NORMALIZE_SCALE = 128.0

# Global ONNX session
ort_session: Optional[ort.InferenceSession] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ONNX model on startup."""
    global ort_session
    logger.info(f"Loading ONNX model from {MODEL_PATH}")
    
    if not os.path.exists(MODEL_PATH):
        logger.error(f"Model file not found at {MODEL_PATH}")
        raise RuntimeError(f"Model file not found: {MODEL_PATH}")
    
    # Configure ONNX Runtime session options
    sess_options = ort.SessionOptions()
    sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_options.intra_op_num_threads = int(os.getenv("ORT_INTRA_THREADS", "4"))
    sess_options.inter_op_num_threads = int(os.getenv("ORT_INTER_THREADS", "2"))
    
    # Use CPU execution provider (can be changed to CUDA if GPU available)
    providers = ["CPUExecutionProvider"]
    if os.getenv("USE_CUDA", "false").lower() == "true":
        providers.insert(0, "CUDAExecutionProvider")
    
    ort_session = ort.InferenceSession(MODEL_PATH, sess_options=sess_options, providers=providers)
    
    # Verify model I/O
    input_meta = ort_session.get_inputs()[0]
    output_meta = ort_session.get_outputs()[0]
    
    logger.info(f"Model loaded: {input_meta.name} {input_meta.shape} {input_meta.type} -> "
                f"{output_meta.name} {output_meta.shape} {output_meta.type}")
    
    # Validate contract
    assert input_meta.name == INPUT_NAME, f"Input name mismatch: {input_meta.name} != {INPUT_NAME}"
    assert output_meta.name == OUTPUT_NAME, f"Output name mismatch: {output_meta.name} != {OUTPUT_NAME}"
    assert list(input_meta.shape) == list(EXPECTED_INPUT_SHAPE), \
        f"Input shape mismatch: {input_meta.shape} != {EXPECTED_INPUT_SHAPE}"
    assert list(output_meta.shape) == list(EXPECTED_OUTPUT_SHAPE), \
        f"Output shape mismatch: {output_meta.shape} != {EXPECTED_OUTPUT_SHAPE}"
    
    logger.info("Model contract validated successfully")
    
    yield
    
    # Cleanup
    logger.info("Shutting down, releasing ONNX session")
    ort_session = None


app = FastAPI(
    title="HealthGraph rPPG Inference API",
    description="Backend inference for PhysFormer face rPPG model",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InferenceRequest(BaseModel):
    """Request for rPPG inference with preprocessed tensor."""
    # Flattened tensor data as list of floats (length = 1*3*160*128*128 = 7864320)
    data: List[float] = Field(..., description="Flattened float32 tensor data")
    dims: List[int] = Field(..., description="Tensor dimensions [1, 3, 160, 128, 128]")
    
    @field_validator("dims")
    @classmethod
    def validate_dims(cls, v: List[int]) -> List[int]:
        if v != list(EXPECTED_INPUT_SHAPE):
            raise ValueError(f"dims must be {EXPECTED_INPUT_SHAPE}, got {v}")
        return v
    
    @field_validator("data")
    @classmethod
    def validate_data_length(cls, v: List[float]) -> List[float]:
        expected_len = np.prod(EXPECTED_INPUT_SHAPE)
        if len(v) != expected_len:
            raise ValueError(f"data length must be {expected_len}, got {len(v)}")
        return v


class InferenceResponse(BaseModel):
    """Response with raw rPPG waveform."""
    waveform: List[float] = Field(..., description="Raw 160-sample rPPG waveform")
    dims: List[int] = Field(default=[1, 160], description="Output dimensions")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model_loaded: bool
    model_path: str
    input_name: str
    output_name: str
    input_shape: List[int]
    output_shape: List[int]


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy" if ort_session is not None else "degraded",
        model_loaded=ort_session is not None,
        model_path=MODEL_PATH,
        input_name=INPUT_NAME,
        output_name=OUTPUT_NAME,
        input_shape=list(EXPECTED_INPUT_SHAPE),
        output_shape=list(EXPECTED_OUTPUT_SHAPE),
    )


@app.post("/infer", response_model=InferenceResponse)
async def infer(request: InferenceRequest):
    """
    Run rPPG inference on preprocessed tensor.
    
    Frontend must preprocess frames to match exact contract:
    - 160 frames, 128x128, BGR channel order
    - Normalized: (pixel - 127.5) / 128
    - Shape: [1, 3, 160, 128, 128] (NCHW format for frames)
    - dtype: float32
    """
    if ort_session is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Convert to numpy array with correct shape and dtype
        input_array = np.array(request.data, dtype=np.float32).reshape(request.dims)
        
        # Validate finite values
        if not np.all(np.isfinite(input_array)):
            raise HTTPException(status_code=400, detail="Input contains NaN or Infinity values")
        
        # Validate value range (approximately -1 to 1 after normalization)
        if input_array.min() < -1.5 or input_array.max() > 1.5:
            logger.warning(f"Input values outside expected range: min={input_array.min():.4f}, max={input_array.max():.4f}")
        
        # Run inference
        logger.debug(f"Running inference on input shape {input_array.shape}")
        outputs = ort_session.run([OUTPUT_NAME], {INPUT_NAME: input_array})
        
        waveform = outputs[0]
        
        # Validate output
        if waveform.shape != EXPECTED_OUTPUT_SHAPE:
            raise HTTPException(
                status_code=500, 
                detail=f"Unexpected output shape: {waveform.shape} != {EXPECTED_OUTPUT_SHAPE}"
            )
        
        if not np.all(np.isfinite(waveform)):
            raise HTTPException(status_code=500, detail="Model output contains NaN or Infinity")
        
        logger.info(f"Inference successful, waveform range: [{waveform.min():.4f}, {waveform.max():.4f}]")
        
        return InferenceResponse(
            waveform=waveform.flatten().tolist(),
            dims=list(EXPECTED_OUTPUT_SHAPE),
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Inference failed")
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


@app.post("/infer_raw_frames", response_model=InferenceResponse)
async def infer_raw_frames(
    frames: List[List[List[List[int]]]],  # [160, 128, 128, 3] - list of frames, each HWC
):
    """
    Convenience endpoint: accepts raw BGR frames (0-255 uint8) and does preprocessing server-side.
    
    Expected: 160 frames of 128x128 BGR (uint8 0-255)
    Returns: raw rPPG waveform [1, 160]
    
    This is easier for frontend integration - just send raw frames from camera.
    """
    if ort_session is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    try:
        # Validate frame count
        if len(frames) != 160:
            raise HTTPException(status_code=400, detail=f"Expected 160 frames, got {len(frames)}")
        
        # Convert to numpy array: [160, 128, 128, 3] -> [1, 3, 160, 128, 128]
        frames_array = np.array(frames, dtype=np.uint8)  # [160, 128, 128, 3]
        
        # Validate frame dimensions
        if frames_array.shape != (160, 128, 128, 3):
            raise HTTPException(
                status_code=400, 
                detail=f"Each frame must be 128x128x3 (HWC), got {frames_array.shape}"
            )
        
        # Transpose to [1, 3, 160, 128, 128] (NCHW for frames)
        # From [T, H, W, C] to [1, C, T, H, W]
        frames_array = np.transpose(frames_array, (3, 0, 1, 2))  # [3, 160, 128, 128]
        frames_array = np.expand_dims(frames_array, axis=0)  # [1, 3, 160, 128, 128]
        
        # Normalize: (pixel - 127.5) / 128 -> float32
        input_array = (frames_array.astype(np.float32) - NORMALIZE_MEAN) / NORMALIZE_SCALE
        
        # Run inference
        outputs = ort_session.run([OUTPUT_NAME], {INPUT_NAME: input_array})
        waveform = outputs[0]
        
        if waveform.shape != EXPECTED_OUTPUT_SHAPE:
            raise HTTPException(
                status_code=500, 
                detail=f"Unexpected output shape: {waveform.shape} != {EXPECTED_OUTPUT_SHAPE}"
            )
        
        if not np.all(np.isfinite(waveform)):
            raise HTTPException(status_code=500, detail="Model output contains NaN or Infinity")
        
        logger.info(f"Raw frames inference successful, waveform range: [{waveform.min():.4f}, {waveform.max():.4f}]")
        
        return InferenceResponse(
            waveform=waveform.flatten().tolist(),
            dims=list(EXPECTED_OUTPUT_SHAPE),
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Raw frames inference failed")
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)