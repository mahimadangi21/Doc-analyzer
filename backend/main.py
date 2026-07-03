from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
import os
import shutil
import uuid
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "ultrabanker.db")
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")

if not os.path.exists(UPLOADS_DIR):
    os.makedirs(UPLOADS_DIR)

app = FastAPI(title="UltraBanker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

def log_audit(applicant_id: int, action: str, status: str, extra: dict = None):
    log_entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "applicant_id": applicant_id,
        "action": action,
        "status": status,
        "session_id": f"session-{uuid.uuid4()}"
    }
    if extra:
        pii_fields = {"pan_number", "aadhaar_number", "account_number", "name", "dob", "address", "email", "full_name"}
        cleaned_extra = {}
        for k, v in extra.items():
            if k in pii_fields:
                cleaned_extra[k] = "[REDACTED]"
            else:
                cleaned_extra[k] = v
        log_entry["extra"] = cleaned_extra
    print(f"[AUDIT LOG] {json.dumps(log_entry)}")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS loan_type_document_requirements (
        loan_type       TEXT NOT NULL,
        document_type   TEXT NOT NULL,
        is_required     INTEGER NOT NULL DEFAULT 1,
        display_name    TEXT NOT NULL,
        PRIMARY KEY (loan_type, document_type)
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applicants (
        applicant_id   INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name      TEXT NOT NULL,
        email          TEXT NOT NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS loan_application_status (
        applicant_id    INTEGER PRIMARY KEY REFERENCES applicants(applicant_id),
        loan_type       TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'LOAN_RECEIVED'
                        CHECK (status IN ('LOAN_RECEIVED','DOCUMENTS_COMPLETE','DOCUMENTS_INCOMPLETE')),
        missing_docs    TEXT,
        is_submitted    INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS document_job_queue (
        job_id              TEXT PRIMARY KEY,
        applicant_id        INTEGER NOT NULL REFERENCES applicants(applicant_id),
        loan_type           TEXT NOT NULL,
        document_type       TEXT NOT NULL,
        source_uri          TEXT NOT NULL,
        file_name           TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'RECEIVED',
        uploaded_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    conn.commit()

    # Seed data
    cursor.execute("SELECT COUNT(*) FROM loan_type_document_requirements")
    if cursor.fetchone()[0] == 0:
        # Seed requirements
        # PERSONAL_LOAN
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('PERSONAL_LOAN', 'PAN', 1, 'PAN Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('PERSONAL_LOAN', 'AADHAAR', 1, 'Aadhaar Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('PERSONAL_LOAN', 'BANK_STATEMENT', 1, 'Bank Statement');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('PERSONAL_LOAN', 'PAYSLIP', 1, 'Payslip');")

        # BUSINESS_LOAN
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('BUSINESS_LOAN', 'PAN', 1, 'PAN Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('BUSINESS_LOAN', 'AADHAAR', 1, 'Aadhaar Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('BUSINESS_LOAN', 'ITR', 1, 'ITR (Tax Return)');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('BUSINESS_LOAN', 'GST_RETURN', 1, 'GST Return');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('BUSINESS_LOAN', 'PAYSLIP', 0, 'Payslip');")

        # HOME_LOAN
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('HOME_LOAN', 'PAN', 1, 'PAN Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('HOME_LOAN', 'AADHAAR', 1, 'Aadhaar Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('HOME_LOAN', 'BANK_STATEMENT', 1, 'Bank Statement');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('HOME_LOAN', 'PROPERTY_VALUATION', 1, 'Property Valuation Report');")

        # LAP
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'PAN', 1, 'PAN Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'AADHAAR', 1, 'Aadhaar Card');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'PHOTO', 1, 'Passport Size Photo');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'ADDR_PROOF', 1, 'Address Proof');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'BANK_STMT', 1, 'Bank Statement (6 months)');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'SALARY_SLIP', 1, 'Salary Slip (3 months)');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'FORM16', 0, 'Form 16');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'ITR', 1, 'ITR (2 years)');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'PROPERTY_DOC', 1, 'Property Documents');")
        cursor.execute("INSERT INTO loan_type_document_requirements (loan_type, document_type, is_required, display_name) VALUES ('LAP', 'VALUATION_RPT', 1, 'Valuation Report');")

        conn.commit()

        # Seed 6 example applicants
        applicants_seed = [
            ("Alice Smith", "alice@example.com", "PERSONAL_LOAN", [("PAN", "alice_pan.pdf"), ("AADHAAR", "alice_aadhaar.pdf")]), # Incomplete
            ("Bob Jones", "bob@example.com", "PERSONAL_LOAN", [("PAN", "bob_pan.pdf"), ("AADHAAR", "bob_aadhaar.pdf"), ("BANK_STATEMENT", "bob_bank.pdf"), ("PAYSLIP", "bob_payslip.pdf")]), # Complete
            ("Charlie Brown", "charlie@example.com", "BUSINESS_LOAN", [("PAN", "charlie_pan.pdf")]), # Incomplete
            ("David Miller", "david@example.com", "BUSINESS_LOAN", [("PAN", "david_pan.pdf"), ("AADHAAR", "david_aadhaar.pdf"), ("ITR", "david_itr.pdf"), ("GST_RETURN", "david_gst.pdf")]), # Complete
            ("Emma Watson", "emma@example.com", "HOME_LOAN", [("PAN", "emma_pan.pdf"), ("AADHAAR", "emma_aadhaar.pdf"), ("BANK_STATEMENT", "emma_bank.pdf")]), # Incomplete
            ("Frank Castillo", "frank@example.com", "HOME_LOAN", [("PAN", "frank_pan.pdf"), ("AADHAAR", "frank_aadhaar.pdf"), ("BANK_STATEMENT", "frank_bank.pdf"), ("PROPERTY_VALUATION", "frank_property.pdf")]) # Complete
        ]

        for name, email, loan_type, docs in applicants_seed:
            cursor.execute("INSERT INTO applicants (full_name, email) VALUES (?, ?)", (name, email))
            applicant_id = cursor.lastrowid
            
            cursor.execute("INSERT INTO loan_application_status (applicant_id, loan_type, status, is_submitted) VALUES (?, ?, 'LOAN_RECEIVED', 0)", (applicant_id, loan_type))
            
            for doc_type, file_name in docs:
                file_url = f"http://localhost:4000/uploads/seeded_{file_name}"
                # Create a placeholder dummy file in uploads folder
                with open(os.path.join(UPLOADS_DIR, f"seeded_{file_name}"), "w") as f:
                    f.write("Seeded file placeholder")
                cursor.execute(
                    "INSERT INTO document_job_queue (job_id, applicant_id, loan_type, document_type, source_uri, file_name, status) VALUES (?, ?, ?, ?, ?, ?, 'VALIDATED')",
                    (str(uuid.uuid4()), applicant_id, loan_type, doc_type, file_url, file_name)
                )
            conn.commit()
            
            # Compute status
            compute_application_status_internal(conn, applicant_id)

    conn.close()

def compute_application_status_internal(conn, applicant_id):
    cursor = conn.cursor()
    cursor.execute("SELECT loan_type FROM loan_application_status WHERE applicant_id = ?", (applicant_id,))
    app_row = cursor.fetchone()
    if not app_row:
        return
        
    loan_type = app_row["loan_type"]
    
    # Get required documents list (is_required = 1)
    cursor.execute("SELECT document_type FROM loan_type_document_requirements WHERE loan_type = ? AND is_required = 1", (loan_type,))
    required = [r["document_type"] for r in cursor.fetchall()]
    
    # Get uploaded documents list (status = 'VALIDATED')
    cursor.execute("SELECT DISTINCT document_type FROM document_job_queue WHERE applicant_id = ? AND status = 'VALIDATED'", (applicant_id,))
    uploaded = [r["document_type"] for r in cursor.fetchall()]
    
    missing = [d for d in required if d not in uploaded]
    
    if len(required) == 0:
        status = "LOAN_RECEIVED"
    else:
        status = "DOCUMENTS_COMPLETE" if len(missing) == 0 else "DOCUMENTS_INCOMPLETE"
        
    cursor.execute("UPDATE loan_application_status SET status = ?, missing_docs = ?, updated_at = datetime('now') WHERE applicant_id = ?", (status, json.dumps(missing), applicant_id))
    conn.commit()
    return status

@app.on_event("startup")
def startup_event():
    init_db()

class CreateApplicationPayload(BaseModel):
    full_name: str
    email: str
    loan_type: str

@app.get("/loan-types")
def get_loan_types():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT loan_type FROM loan_type_document_requirements")
    rows = cursor.fetchall()
    
    types = []
    for r in rows:
        lt = r["loan_type"]
        display_name = lt.replace("_", " ").title()
        
        cursor.execute("SELECT document_type, display_name, is_required FROM loan_type_document_requirements WHERE loan_type = ?", (lt,))
        reqs = [dict(row) for row in cursor.fetchall()]
        
        types.append({
            "code": lt,
            "display_name": display_name,
            "required_docs": reqs
        })
        
    conn.close()
    return types

@app.get("/applications")
def get_applications():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            a.applicant_id as application_id,
            a.status,
            a.is_submitted,
            a.created_at,
            ap.full_name,
            ap.email,
            a.loan_type
        FROM loan_application_status a
        JOIN applicants ap ON a.applicant_id = ap.applicant_id
        ORDER BY a.applicant_id DESC
    """)
    rows = []
    for r in cursor.fetchall():
        d = dict(r)
        d["loan_type_code"] = d["loan_type"]
        d["loan_type"] = d["loan_type"].replace("_", " ").title()
        rows.append(d)
    conn.close()
    return rows

@app.get("/applications/{applicant_id}")
def get_application_detail(applicant_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.applicant_id, a.loan_type, a.status, a.is_submitted
        FROM loan_application_status a
        WHERE a.applicant_id = ?
    """, (applicant_id,))
    app_row = cursor.fetchone()
    if not app_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Application not found")
        
    cursor.execute("SELECT document_type, display_name, is_required FROM loan_type_document_requirements WHERE loan_type = ?", (app_row["loan_type"],))
    reqs = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("SELECT document_type, file_name, source_uri as file_url, uploaded_at FROM document_job_queue WHERE applicant_id = ?", (applicant_id,))
    uploaded = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    checklist = []
    for req in reqs:
        up = next((u for u in uploaded if u["document_type"] == req["document_type"]), None)
        checklist.append({
            "document_type": req["document_type"],
            "display_name": req["display_name"],
            "is_required": bool(req["is_required"]),
            "uploaded": up is not None,
            "file_name": up["file_name"] if up else None,
            "file_url": up["file_url"] if up else None,
            "uploaded_at": up["uploaded_at"] if up else None
        })
        
    return {
        "application_id": app_row["applicant_id"],
        "loan_type": app_row["loan_type"].replace("_", " ").title(),
        "loan_type_code": app_row["loan_type"],
        "status": app_row["status"],
        "is_submitted": bool(app_row["is_submitted"]),
        "checklist": checklist
    }

@app.post("/applications", status_code=201)
def create_application(payload: CreateApplicationPayload):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO applicants (full_name, email) VALUES (?, ?)", (payload.full_name, payload.email))
        applicant_id = cursor.lastrowid
        
        cursor.execute("INSERT INTO loan_application_status (applicant_id, loan_type, status, is_submitted) VALUES (?, ?, 'LOAN_RECEIVED', 0)", (applicant_id, payload.loan_type))
        conn.commit()
        
        compute_application_status_internal(conn, applicant_id)
        log_audit(applicant_id, "CREATE_APPLICATION", "LOAN_RECEIVED", {"loan_type": payload.loan_type})
        
        cursor.execute("""
            SELECT 
                a.applicant_id as application_id,
                a.status,
                a.is_submitted,
                a.created_at,
                ap.full_name,
                ap.email,
                a.loan_type
            FROM loan_application_status a
            JOIN applicants ap ON a.applicant_id = ap.applicant_id
            WHERE a.applicant_id = ?
        """, (applicant_id,))
        new_app = dict(cursor.fetchone())
        new_app["loan_type_code"] = new_app["loan_type"]
        new_app["loan_type"] = new_app["loan_type"].replace("_", " ").title()
        conn.close()
        return new_app
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/applications/{applicant_id}/submit")
def submit_application(applicant_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT applicant_id FROM loan_application_status WHERE applicant_id = ?", (applicant_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Application not found")
            
        cursor.execute("UPDATE loan_application_status SET is_submitted = 1, updated_at = datetime('now') WHERE applicant_id = ?", (applicant_id,))
        conn.commit()
        
        status = compute_application_status_internal(conn, applicant_id)
        log_audit(applicant_id, "SUBMIT_APPLICATION", status)
        conn.close()
        return {"success": True, "status": status, "is_submitted": True}
    except Exception as e:
      conn.rollback()
      conn.close()
      raise HTTPException(status_code=500, detail=str(e))

@app.post("/applications/{applicant_id}/documents")
def upload_document(applicant_id: int, file: UploadFile = File(...), document_type: str = Form(...)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT applicant_id, loan_type, is_submitted FROM loan_application_status WHERE applicant_id = ?", (applicant_id,))
        app_row = cursor.fetchone()
        if not app_row:
            raise HTTPException(status_code=404, detail="Application not found")
            
        if app_row["is_submitted"] == 1:
            raise HTTPException(status_code=400, detail="Cannot upload documents: Application is already submitted")
            
        loan_type = app_row["loan_type"]
        file_ext = os.path.splitext(file.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        dest_path = os.path.join(UPLOADS_DIR, unique_filename)
        
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        file_url = f"http://localhost:4000/uploads/{unique_filename}"
        
        # Check if already uploaded
        cursor.execute("SELECT job_id FROM document_job_queue WHERE applicant_id = ? AND document_type = ?", (applicant_id, document_type))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute(
                "UPDATE document_job_queue SET file_name = ?, source_uri = ?, status = 'VALIDATED', uploaded_at = datetime('now') WHERE job_id = ?",
                (file.filename, file_url, existing["job_id"])
            )
        else:
            cursor.execute(
                "INSERT INTO document_job_queue (job_id, applicant_id, loan_type, document_type, source_uri, file_name, status) VALUES (?, ?, ?, ?, ?, ?, 'VALIDATED')",
                (str(uuid.uuid4()), applicant_id, loan_type, document_type, file_url, file.filename)
            )
        conn.commit()
        
        status = compute_application_status_internal(conn, applicant_id)
        log_audit(applicant_id, "UPLOAD_DOCUMENT", status, {"document_type": document_type})
        conn.close()
        return {"success": True, "status": status}
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))

class UpdateRequirementPayload(BaseModel):
    document_type: str
    is_required: bool

@app.put("/loan-types/{loan_type}/requirements")
def update_loan_type_requirements(loan_type: str, payload: UpdateRequirementPayload):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM loan_type_document_requirements WHERE loan_type = ? AND document_type = ?", (loan_type, payload.document_type))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Requirement configuration not found")
            
        cursor.execute(
            "UPDATE loan_type_document_requirements SET is_required = ? WHERE loan_type = ? AND document_type = ?",
            (1 if payload.is_required else 0, loan_type, payload.document_type)
        )
        conn.commit()

        # Recalculate status for all applications of this loan type
        cursor.execute("SELECT applicant_id FROM loan_application_status WHERE loan_type = ?", (loan_type,))
        apps_to_update = [r["applicant_id"] for r in cursor.fetchall()]
        for app_id in apps_to_update:
            compute_application_status_internal(conn, app_id)

        log_audit(0, "UPDATE_CONFIG", "SUCCESS", {"loan_type": loan_type, "document_type": payload.document_type, "is_required": payload.is_required})
        conn.close()
        return {"success": True}
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=str(e))
