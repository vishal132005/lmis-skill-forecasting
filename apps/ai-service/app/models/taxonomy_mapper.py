"""
Taxonomy Mapper – Maps raw job titles to NCO/NSQF/QP codes.

POST /ai/map-job-title
Input: raw job title/description text (+language)
Output: NCO code, NSQF/QP code, trade, confidence

TODO: Replace mock with NLP-based classifier (e.g., fine-tuned BERT on NCO taxonomy).
"""
import hashlib
from datetime import datetime
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel as PydanticBase, Field
from .base import BaseModel

router = APIRouter()

# ─── Pydantic Schemas ──────────────────────────────────────────

class MapJobTitleRequest(PydanticBase):
    """Request to map a raw job title to standardised codes."""
    job_title: str = Field(..., min_length=2, max_length=500, description="Raw job title or description text")
    language: str = Field(default="en", description="Language code (en, hi, mr, ta)")
    context: Optional[str] = Field(default=None, description="Additional context like industry or location")

class MappedCode(PydanticBase):
    """A single mapping result with confidence."""
    nco_code: str = Field(..., description="National Classification of Occupations code")
    nsqf_level: int = Field(..., ge=1, le=10, description="NSQF level (1-10)")
    qp_code: str = Field(..., description="Qualification Pack code")
    trade_name: str = Field(..., description="Standardised trade name")
    sector: str = Field(..., description="Sector name")
    confidence: float = Field(..., ge=0, le=1, description="Mapping confidence score")

class MapJobTitleResponse(PydanticBase):
    """Response containing mapped taxonomy codes."""
    is_mock: bool = Field(default=True, description="Whether this is mock output")
    input_title: str
    mappings: list[MappedCode] = Field(..., description="Top matched codes, sorted by confidence")
    processing_time_ms: float

# ─── Mock Model ────────────────────────────────────────────────

# Lookup table for deterministic mock responses
MOCK_MAPPINGS = {
    "nurse": MappedCode(nco_code="5321", nsqf_level=4, qp_code="HSS/Q5101", trade_name="General Duty Assistant", sector="Healthcare", confidence=0.92),
    "electrician": MappedCode(nco_code="7411", nsqf_level=4, qp_code="CON/Q0501", trade_name="Construction Electrician", sector="Construction", confidence=0.88),
    "data entry": MappedCode(nco_code="4132", nsqf_level=3, qp_code="SSC/Q2212", trade_name="Data Entry Operator", sector="IT-ITeS", confidence=0.95),
    "ev": MappedCode(nco_code="7412", nsqf_level=4, qp_code="ELE/Q1201", trade_name="EV Service Technician", sector="Electronics & EV", confidence=0.87),
    "solar": MappedCode(nco_code="7411", nsqf_level=4, qp_code="ELE/Q5901", trade_name="Solar Panel Installer", sector="Electronics & EV", confidence=0.90),
    "plumber": MappedCode(nco_code="7126", nsqf_level=4, qp_code="CON/Q0602", trade_name="Plumber", sector="Construction", confidence=0.94),
    "web developer": MappedCode(nco_code="2513", nsqf_level=5, qp_code="SSC/Q0503", trade_name="Junior Web Developer", sector="IT-ITeS", confidence=0.91),
    "cloud": MappedCode(nco_code="2523", nsqf_level=5, qp_code="SSC/Q5601", trade_name="Cloud Computing Associate", sector="IT-ITeS", confidence=0.86),
    "mason": MappedCode(nco_code="7112", nsqf_level=4, qp_code="CON/Q0102", trade_name="Mason (General)", sector="Construction", confidence=0.93),
    "emt": MappedCode(nco_code="3258", nsqf_level=5, qp_code="HSS/Q0601", trade_name="Emergency Medical Technician", sector="Healthcare", confidence=0.89),
}

DEFAULT_MAPPING = MappedCode(nco_code="9999", nsqf_level=3, qp_code="GEN/Q0001", trade_name="General Worker", sector="Multi-sector", confidence=0.45)


class TaxonomyMapper(BaseModel):
    """Maps raw job titles to NCO/NSQF taxonomy codes."""

    _name = "taxonomy_mapper"
    _version = "0.1.0-mock"
    _is_mock = True

    def load(self) -> None:
        """Load taxonomy mapping model.

        # TODO: IMPLEMENT MODEL HERE
        # Load your fine-tuned NLP classifier here.
        # Example:
        #   self.tokenizer = AutoTokenizer.from_pretrained("your-model")
        #   self.model = AutoModelForSequenceClassification.from_pretrained("your-model")
        #   self._is_mock = False
        """
        self._loaded_at = datetime.now()

    def predict(self, input_data: dict) -> dict:
        """Map a job title to taxonomy codes.

        # TODO: IMPLEMENT MODEL HERE
        # Replace the mock lookup below with your NLP inference.
        # The input_data dict matches MapJobTitleRequest schema.
        """
        title = input_data["job_title"].lower().strip()

        # Mock: check for keyword matches
        mappings = []
        for keyword, mapping in MOCK_MAPPINGS.items():
            if keyword in title:
                mappings.append(mapping)

        if not mappings:
            # Generate deterministic result based on title hash
            h = int(hashlib.md5(title.encode()).hexdigest(), 16) % 100
            default = DEFAULT_MAPPING.model_copy()
            default.confidence = round(0.3 + (h / 200), 2)
            mappings = [default]

        return {
            "is_mock": self._is_mock,
            "input_title": input_data["job_title"],
            "mappings": [m.model_dump() for m in mappings[:5]],
            "processing_time_ms": 12.5,
        }


# Singleton
_model = TaxonomyMapper()
_model.load()


@router.post("/map-job-title", response_model=MapJobTitleResponse)
async def map_job_title(request: MapJobTitleRequest) -> MapJobTitleResponse:
    """Map a raw job title or description to standardised NCO/NSQF/QP codes.

    This endpoint takes free-text job titles (in any supported language) and returns
    the best-matching taxonomy codes with confidence scores.

    **Mock mode**: Returns deterministic keyword-based matches.
    **Real mode**: Will use NLP classifier for semantic matching.
    """
    result = _model.predict(request.model_dump())
    return MapJobTitleResponse(**result)
