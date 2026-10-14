"""OData-клиент для 1С (стандартный интерфейс OData, документация платформы п. 17.4).

Использование: подключение с transport='odata' и settings:
  { "base_url": "http://server/base", "username": "...", "password": "...", "probe_entity": "Catalog_Номенклатура" }

Возможности: проверка соединения ($metadata), чтение сущностей ($format=json, $top/$skip/$filter),
создание объектов (POST), маппинг строк справочников 1С в элементы пакета profyplan.exchange.v1.
"""
from __future__ import annotations

from typing import Optional

import httpx


class ODataError(Exception):
    pass


CATALOG_MAP = {
    "Номенклатура": "nomenclature",
    "Контрагенты": "counterparty",
    "СтруктурныеЕдиницы": "department",
    "ПодразделенияОрганизаций": "department",
    "КлючевыеРесурсы": "resource",
    "Проекты": "project",
}


def map_catalog_row(entity_suffix: str, row: dict) -> dict:
    """Строка сущности 1С → fields пакета ProfyPlan."""
    f: dict = {}
    name = row.get("Наименование") or row.get("Description") or ""
    if name:
        f["name"] = str(name)
    code = row.get("Код") or row.get("Code")
    if code not in (None, ""):
        f["code"] = str(code)
    art = row.get("Артикул")
    if art not in (None, ""):
        f["article"] = str(art)
    inn = row.get("ИНН")
    if inn not in (None, ""):
        f["inn"] = str(inn)
    if entity_suffix == "Номенклатура":
        # Вид номенклатуры в 1С — ссылка; переносим признак по имени, если отдан текстом
        kind = row.get("ВидНоменклатуры")
        if isinstance(kind, str) and kind:
            f["type"] = kind
        unit = row.get("ЕдиницаИзмерения")
        if isinstance(unit, str) and unit:
            f["unit"] = unit
    return f


class ODataClient:
    def __init__(self, base_url: str, username: Optional[str] = None, password: Optional[str] = None, timeout: float = 30.0):
        self.base = (base_url or "").rstrip("/")
        if not self.base:
            raise ODataError("Не задан адрес OData (base_url)")
        self.auth = (username, password or "") if username else None
        self.timeout = timeout

    def _url(self, entity: str) -> str:
        return "%s/odata/standard.odata/%s" % (self.base, entity)

    async def _request(self, method: str, url: str, **kw) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, auth=self.auth, follow_redirects=True) as cl:
                r = await cl.request(method, url, **kw)
        except httpx.HTTPError as e:
            raise ODataError("OData недоступен: %s" % e)
        return r

    async def metadata(self) -> str:
        """Проверка соединения: служебный документ $metadata."""
        r = await self._request("GET", "%s/odata/standard.odata/$metadata" % self.base)
        if r.status_code >= 400:
            raise ODataError("OData ответил %s на $metadata: %s" % (r.status_code, r.text[:200]))
        return r.text

    async def get_entities(
        self,
        entity: str,
        top: int = 100,
        skip: int = 0,
        filter_expr: Optional[str] = None,
        orderby: Optional[str] = None,
    ) -> list:
        params = {"$format": "json", "$top": str(max(1, min(top, 1000))), "$skip": str(max(0, skip))}
        if filter_expr:
            params["$filter"] = filter_expr
        if orderby:
            params["$orderby"] = orderby
        r = await self._request("GET", self._url(entity), params=params, headers={"Accept": "application/json"})
        if r.status_code >= 400:
            raise ODataError("OData ответил %s на %s: %s" % (r.status_code, entity, r.text[:200]))
        try:
            data = r.json()
        except Exception:
            raise ODataError("OData вернул не-JSON для %s (проверьте $format и публикацию)" % entity)
        return list(data.get("value") or [])

    async def create_entity(self, entity: str, payload: dict) -> dict:
        r = await self._request(
            "POST", self._url(entity), json=payload, headers={"Content-Type": "application/json"}
        )
        if r.status_code >= 400:
            raise ODataError("OData отклонил создание %s (%s): %s" % (entity, r.status_code, r.text[:300]))
        try:
            return r.json() if r.content else {}
        except Exception:
            return {}

    async def ping(self, probe_entity: Optional[str] = None) -> dict:
        """Проверка: $metadata + (опционально) чтение одной строки указанной сущности."""
        await self.metadata()
        info = {"metadata": "ok"}
        if probe_entity:
            rows = await self.get_entities(probe_entity, top=1)
            info["probe"] = {"entity": probe_entity, "rows": len(rows)}
        return info
