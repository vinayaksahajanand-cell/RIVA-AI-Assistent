from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.analytics import service
from app.api.deps import AuthContext, require_permission
from app.core.rbac import Permission
from app.database.session import get_db
from app.schemas.analytics import AnalyticsOverview, EvaluationAnalytics, PerformanceAnalytics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _filters(ctx: AuthContext = Depends(require_permission(Permission.ANALYTICS_VIEW)), date_from: date | None = None, date_to: date | None = None,
             model: str | None = Query(default=None, max_length=100),
             collection_id: uuid.UUID | None = None) -> service.Filters:
    return service.Filters(workspace_id=ctx.workspace_id, date_from=date_from, date_to=date_to, model=model,
                           collection_id=collection_id)


@router.get("/overview", response_model=AnalyticsOverview)
async def overview(f: service.Filters = Depends(_filters), db: AsyncSession = Depends(get_db)):
    return await service.overview(db, f)


@router.get("/performance", response_model=PerformanceAnalytics)
async def performance(f: service.Filters = Depends(_filters), db: AsyncSession = Depends(get_db)):
    return await service.performance(db, f)


@router.get("/evaluations", response_model=EvaluationAnalytics)
async def evaluations(f: service.Filters = Depends(_filters), db: AsyncSession = Depends(get_db)):
    return await service.evaluations(db, f)
