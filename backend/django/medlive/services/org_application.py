"""A hospital applies by itself (port of `services/orgApplication.service.ts`; FR-ONB-09, FR-ONB-10).

`POST /hospital-applications` is public: no account exists yet. It makes a
workspace that is setting up and its first administrator, and nothing else:
not live, in no list, its code opening nothing until a person at the platform
approves (FR-ONB-04). The request is nobody's, so the rows are written as the
server's own work, stated here. Open applications are capped for the whole
deployment; the same form sent twice with one key answers with the first.
The password is never logged, returned or stored except as its hash.
"""

from __future__ import annotations

from typing import Any

from ..core import db
from ..core.env import env
from ..core.errors import AppError
from ..core.password import hash_password, password_problem
from ..core.scope import SYSTEM, db_scope
from ..domain.org import code_for, code_stem
from ..repositories import hospital_settings as settings_repo
from ..repositories import org_application as repo
from ..repositories import staff_auth as staff_auth_repo

#: How many times a code is chosen again when two applications took the same one at once.
CODE_ATTEMPTS = 4


def _constraint_of(thrown: BaseException) -> str | None:
    for error in (thrown, getattr(thrown, "__cause__", None)):
        if error is not None and getattr(error, "sqlstate", None) == "23505":
            diag = getattr(error, "diag", None)
            name = getattr(diag, "constraint_name", None)
            return name if isinstance(name, str) else None
    return None


def apply(*, body: dict[str, Any], key: str, ip: str | None, user_agent: str | None) -> dict[str, str]:
    problem = password_problem(body["password"])
    if problem is not None:
        raise AppError("AUTH_PASSWORD_WEAK", details={"reason": problem})
    with db_scope(SYSTEM):
        before = repo.find_by_key(key)
        if before is not None:
            return {"code": before["code"], "adminEmail": before["adminEmail"]}
        if repo.open_applications() >= env().ORG_APPLICATIONS_OPEN_MAX:
            raise AppError("RATE_LIMITED", details={"reason": "applications_paused"})
        password_hash = hash_password(body["password"])
        for _attempt in range(CODE_ATTEMPTS):
            code = code_for(body["nameEn"], repo.codes_from(code_stem(body["nameEn"])))
            if code is None:
                raise AppError("SETTINGS_DUPLICATE", details={"field": "nameEn"})
            try:
                with db.transaction():
                    hospital_id = repo.create_workspace(
                        code=code,
                        key=key,
                        name_bn=body["nameBn"],
                        name_en=body["nameEn"],
                        kind=body["kind"],
                        division=body["division"],
                        district=body["district"],
                        phone=body["phone"],
                        registration_no=body["registrationNo"],
                    )
                    staff_id = repo.create_applicant(
                        hospital_id=hospital_id,
                        email=body["adminEmail"],
                        full_name=body["adminName"],
                        phone=body["adminMobile"],
                        password_hash=password_hash,
                    )
                    staff_auth_repo.grant_role(staff_id=staff_id, hospital_id=hospital_id, role="hospital_admin")
                    # Who applied, when and from where (FR-ONB-07); the actor is
                    # the account the application made.
                    settings_repo.record_change(
                        actor_staff_id=staff_id,
                        hospital_id=hospital_id,
                        subject_table="hospitals",
                        subject_id=hospital_id,
                        change="workspace_applied",
                        ip=ip,
                        user_agent=user_agent,
                    )
                return {"code": code, "adminEmail": body["adminEmail"]}
            except Exception as thrown:
                constraint = _constraint_of(thrown)
                # The same form, sent twice at once: the other one made it.
                if constraint == "hospitals_application_key_key":
                    made = repo.find_by_key(key)
                    if made is not None:
                        return {"code": made["code"], "adminEmail": made["adminEmail"]}
                # Another application took this code between the look and the write.
                if constraint == "hospitals_code_key":
                    continue
                raise
        raise AppError("WRITE_CONFLICT")
