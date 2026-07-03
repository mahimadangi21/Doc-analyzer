import json
from datetime import datetime

def check_required_documents_internal(conn, applicant_id):
    cursor = conn.cursor()
    
    # 1. Fetch applicant's loan type and current status
    cursor.execute("""
        SELECT a.loan_type_id, a.status, lt.code as loan_type_code
        FROM applications a
        JOIN loan_types lt ON a.loan_type_id = lt.loan_type_id
        WHERE a.applicant_id = ?
    """, (applicant_id,))
    app = cursor.fetchone()
    if not app:
        raise ValueError(f"Application for applicant ID {applicant_id} not found")
        
    loan_type_id = app["loan_type_id"]
    from_status = app["status"]
    
    # 2. Get required documents (is_active = 1 only)
    cursor.execute("""
        SELECT document_type
        FROM required_documents
        WHERE loan_type_id = ? AND is_active = 1
    """, (loan_type_id,))
    required = [row["document_type"] for row in cursor.fetchall()]
    
    # 3. Get uploaded documents
    cursor.execute("""
        SELECT document_type
        FROM uploaded_documents
        WHERE applicant_id = ?
    """, (applicant_id,))
    uploaded = [row["document_type"] for row in cursor.fetchall()]
    
    # 4. Compute missing documents
    missing = [doc for doc in required if doc not in uploaded]
    
    now_str = datetime.now().isoformat()
    
    if missing:
        to_status = "DOCUMENTS_INCOMPLETE"
        reason = ",".join(missing)
        missing_json = json.dumps(missing)
        
        # Update application
        cursor.execute("""
            UPDATE applications
            SET status = ?, missing_documents = ?, updated_at = ?
            WHERE applicant_id = ?
        """, (to_status, missing_json, now_str, applicant_id))
        
        # Write history (only if status changed or reasons updated, but let's record every status check change)
        # Check last status history entry to avoid spamming identical ones, or just write it on transition
        if from_status != to_status:
            cursor.execute("""
                INSERT INTO status_history (applicant_id, from_status, to_status, reason, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (applicant_id, from_status, to_status, reason, now_str))
            
        # Ensure exactly one open ops_queue entry exists
        cursor.execute("""
            SELECT ops_queue_id, missing_documents
            FROM ops_queue
            WHERE applicant_id = ? AND resolved_at IS NULL
        """, (applicant_id,))
        open_item = cursor.fetchone()
        
        if open_item:
            # If missing documents list changed, update it
            if open_item["missing_documents"] != missing_json:
                cursor.execute("""
                    UPDATE ops_queue
                    SET missing_documents = ?
                    WHERE ops_queue_id = ?
                """, (missing_json, open_item["ops_queue_id"]))
        else:
            # Insert a new ops queue entry
            cursor.execute("""
                INSERT INTO ops_queue (applicant_id, missing_documents, raised_at)
                VALUES (?, ?, ?)
            """, (applicant_id, missing_json, now_str))
            
        conn.commit()
        return False
    else:
        to_status = "DOCUMENTS_COMPLETE"
        reason = None
        
        # Update application
        cursor.execute("""
            UPDATE applications
            SET status = ?, missing_documents = NULL, updated_at = ?
            WHERE applicant_id = ?
        """, (to_status, now_str, applicant_id))
        
        # History
        if from_status != to_status:
            cursor.execute("""
                INSERT INTO status_history (applicant_id, from_status, to_status, reason, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (applicant_id, from_status, to_status, reason, now_str))
            
        # Auto-resolve any open ops queue entries since they are now complete
        cursor.execute("""
            UPDATE ops_queue
            SET resolved_at = ?, resolution_note = 'System resolved: all documents uploaded'
            WHERE applicant_id = ? AND resolved_at IS NULL
        """, (now_str, applicant_id))
        
        conn.commit()
        return True
