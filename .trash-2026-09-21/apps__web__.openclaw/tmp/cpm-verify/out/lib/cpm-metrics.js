"use strict";
/**
 * Чистая геометрия раскладки сети CPM и метрики её качества.
 *
 * Модуль намеренно не зависит от React: одни и те же функции используют
 * отрисовка узлов/связей (`CpmGraph`), подсчёт метрик раскладки и автотест.
 *
 * Метрики раскладки (в мировых координатах, т.е. не зависят от зума):
 *   • crossings     — сколько пар связей пересекаются между собой
 *                     (пересечение отрезков; пары с общим концом не считаются);
 *   • edgeNodeHits  — сколько связей проходит сквозь прямоугольник
 *                     постороннего узла (свои концы не считаются);
 *   • nodeOverlaps  — сколько пар узлов перекрываются прямоугольниками;
 *   • density       — суммарная площадь узлов к площади полотна, в процентах.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETOUR_OFFSETS = exports.PATH_SAMPLES = exports.OBSTACLE_PAD = exports.EDGE_PAD = exports.CARD_H = exports.CARD_W = void 0;
exports.borderPoint = borderPoint;
exports.quadPt = quadPt;
exports.segRectHit = segRectHit;
exports.pathHits = pathHits;
exports.segCross = segCross;
exports.rectsOverlap = rectsOverlap;
exports.edgeControl = edgeControl;
exports.computeLayoutMetrics = computeLayoutMetrics;
/** Размер карточки узла в мировых координатах. */
exports.CARD_W = 208;
exports.CARD_H = 60;
/** Зазор, на который линия «отступает» от границы своего узла (как при отрисовке). */
exports.EDGE_PAD = 3;
/** Дополнительный зазор прямоугольников-препятствий при выборе обхода (как при отрисовке). */
exports.OBSTACLE_PAD = 6;
/** Число точек выборки кривой при проверке прохода сквозь узлы (метрика и отрисовка). */
exports.PATH_SAMPLES = 16;
/** Точка на границе прямоугольника/окружности по направлению к (tx,ty). */
function borderPoint(cx, cy, hw, hh, tx, ty) {
    const dx = tx - cx;
    const dy = ty - cy;
    if (dx === 0 && dy === 0)
        return [cx, cy];
    const tx1 = dx === 0 ? Infinity : hw / Math.abs(dx);
    const ty1 = dy === 0 ? Infinity : hh / Math.abs(dy);
    const t = Math.min(tx1, ty1);
    return [cx + dx * t, cy + dy * t];
}
/** Точка квадратичной кривой Безье при параметре t. */
function quadPt(x0, y0, cx, cy, x1, y1, t) {
    const mt = 1 - t;
    return [mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1];
}
/** Пересекается ли отрезок (x1,y1)-(x2,y2) с прямоугольником (cx,cy,±hw,±hh) — slab-метод. */
function segRectHit(x1, y1, x2, y2, cx, cy, hw, hh) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - (cx - hw), cx + hw - x1, y1 - (cy - hh), cy + hh - y1];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0)
                return false;
        }
        else {
            const r = q[i] / p[i];
            if (p[i] < 0) {
                if (r > t1)
                    return false;
                if (r > t0)
                    t0 = r;
            }
            else {
                if (r < t0)
                    return false;
                if (r < t1)
                    t1 = r;
            }
        }
    }
    return true;
}
/** Сколько сэмплов кривой Безье попадает в посторонние узлы-препятствия. */
function pathHits(x0, y0, cx, cy, x1, y1, obstacles, samples) {
    // Прямая связь (без отклонения) — быстрая проверка через отрезок.
    if (cx === (x0 + x1) / 2 && cy === (y0 + y1) / 2) {
        let h = 0;
        for (let k = 0; k < obstacles.length; k++) {
            const ob = obstacles[k];
            if (segRectHit(x0, y0, x1, y1, ob.x, ob.y, ob.hw, ob.hh))
                h++;
        }
        return h;
    }
    let hits = 0;
    for (let i = 1; i < samples; i++) {
        const [qx, qy] = quadPt(x0, y0, cx, cy, x1, y1, i / samples);
        for (let k = 0; k < obstacles.length; k++) {
            const ob = obstacles[k];
            if (qx > ob.x - ob.hw && qx < ob.x + ob.hw && qy > ob.y - ob.hh && qy < ob.y + ob.hh) {
                hits++;
                break;
            }
        }
    }
    return hits;
}
/**
 * Кандидаты отклонения связи при обходе посторонних узлов (как при отрисовке).
 * Порядок — по возрастанию «крутизны» дуги, поэтому первое отклонение с нулём
 * проходов сквозь узлы и есть обход минимальным отклонением.
 */
exports.DETOUR_OFFSETS = [10, -10, 16, -16, 24, -24, 34, -34, 46, -46, 60, -60, 78, -78, 100, -100, 126, -126, 156, -156, 190, -190, 232, -232, 282, -282, 340, -340];
function round1(v) {
    return Math.round(v * 10) / 10;
}
/** Знак векторного произведения (b−a)×(c−a). */
function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}
/** Лежит ли точка c на отрезке ab (при коллинеарности). */
function onSeg(ax, ay, bx, by, cx, cy) {
    const eps = 1e-9;
    return (cx >= Math.min(ax, bx) - eps && cx <= Math.max(ax, bx) + eps &&
        cy >= Math.min(ay, by) - eps && cy <= Math.max(ay, by) + eps);
}
/** Пересекаются ли отрезки (p1p2) и (p3p4), включая касание. */
function segCross(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    const d1 = orient(p3x, p3y, p4x, p4y, p1x, p1y);
    const d2 = orient(p3x, p3y, p4x, p4y, p2x, p2y);
    const d3 = orient(p1x, p1y, p2x, p2y, p3x, p3y);
    const d4 = orient(p1x, p1y, p2x, p2y, p4x, p4y);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
        return true;
    if (Math.abs(d1) < 1e-9 && onSeg(p3x, p3y, p4x, p4y, p1x, p1y))
        return true;
    if (Math.abs(d2) < 1e-9 && onSeg(p3x, p3y, p4x, p4y, p2x, p2y))
        return true;
    if (Math.abs(d3) < 1e-9 && onSeg(p1x, p1y, p2x, p2y, p3x, p3y))
        return true;
    if (Math.abs(d4) < 1e-9 && onSeg(p1x, p1y, p2x, p2y, p4x, p4y))
        return true;
    return false;
}
/** Пересекаются ли прямоугольники (строгое наложение площади, не просто касание). */
function rectsOverlap(a, b) {
    return Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
}
/**
 * Контрольная точка квадратичной кривой для связи s→e. Если прямая проходит
 * сквозь посторонние узлы, подбирается минимальное отклонение вбок, при котором
 * путь не задевает узлы; иначе связь остаётся прямой (контрольная точка = середина).
 * Возвращает контрольную точку Безье в мировых координатах.
 */
function edgeControl(sxw, syw, exw, eyw, obstacles) {
    const dxw = exw - sxw;
    const dyw = eyw - syw;
    const lenw = Math.hypot(dxw, dyw) || 1;
    const pxw = -dyw / lenw;
    const pyw = dxw / lenw;
    const mxw = (sxw + exw) / 2;
    const myw = (syw + eyw) / 2;
    let bestOff = 0;
    let bestHits = pathHits(sxw, syw, mxw, myw, exw, eyw, obstacles, exports.PATH_SAMPLES);
    if (bestHits > 0) {
        for (const off of exports.DETOUR_OFFSETS) {
            const cxx = mxw + pxw * off * 2;
            const cyy = myw + pyw * off * 2;
            const hits = pathHits(sxw, syw, cxx, cyy, exw, eyw, obstacles, exports.PATH_SAMPLES);
            if (hits === 0) {
                bestOff = off;
                bestHits = 0;
                break;
            }
            if (hits < bestHits) {
                bestHits = hits;
                bestOff = off;
            }
        }
    }
    return [mxw + pxw * bestOff * 2, myw + pyw * bestOff * 2];
}
/**
 * Считает метрики текущей раскладки. Работает в мировых координатах,
 * поэтому не зависит от масштаба просмотра; учитывает фильтр критического пути.
 */
function computeLayoutMetrics(layout, nodes, deps, critOnly) {
    const vis = nodes.filter((n) => layout.pos[n.id] && (!critOnly || n.crit));
    const visIds = new Set(vis.map((n) => n.id));
    const rects = vis.map((n) => {
        const p = layout.pos[n.id];
        return { id: n.id, x: p[0], y: p[1], hw: exports.CARD_W / 2, hh: exports.CARD_H / 2 };
    });
    // ── наложения узлов ──
    let nodeOverlaps = 0;
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            if (rectsOverlap(rects[i], rects[j]))
                nodeOverlaps++;
        }
    }
    const edges = [];
    const seen = new Set();
    for (const [aId, bId] of deps) {
        if (aId === bId)
            continue;
        if (!visIds.has(aId) || !visIds.has(bId))
            continue;
        const key = aId + '\u0001' + bId;
        if (seen.has(key))
            continue;
        seen.add(key);
        const pa = layout.pos[aId];
        const pb = layout.pos[bId];
        const s = borderPoint(pa[0], pa[1], exports.CARD_W / 2 + exports.EDGE_PAD, exports.CARD_H / 2 + exports.EDGE_PAD, pb[0], pb[1]);
        const e = borderPoint(pb[0], pb[1], exports.CARD_W / 2 + exports.EDGE_PAD, exports.CARD_H / 2 + exports.EDGE_PAD, pa[0], pa[1]);
        const obstacles = rects
            .filter((r) => r.id !== aId && r.id !== bId)
            .map((r) => ({ x: r.x, y: r.y, hw: r.hw + exports.OBSTACLE_PAD, hh: r.hh + exports.OBSTACLE_PAD }));
        const c = edgeControl(s[0], s[1], e[0], e[1], obstacles);
        edges.push({ a: aId, b: bId, s, e, c });
    }
    // ── наложения связей на посторонние узлы ──
    let edgeNodeHits = 0;
    for (const ed of edges) {
        const actual = rects.filter((r) => r.id !== ed.a && r.id !== ed.b);
        if (pathHits(ed.s[0], ed.s[1], ed.c[0], ed.c[1], ed.e[0], ed.e[1], actual, exports.PATH_SAMPLES) > 0)
            edgeNodeHits++;
    }
    // ── пересечения связей ──
    let crossings = 0;
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            const A = edges[i];
            const B = edges[j];
            if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b)
                continue; // общий конец
            if (segCross(A.s[0], A.s[1], A.e[0], A.e[1], B.s[0], B.s[1], B.e[0], B.e[1]))
                crossings++;
        }
    }
    // ── плотность: площадь узлов к площади полотна ──
    // Габарит считается по реальным узлам (а не по layout.minX/maxX): так в
    // геометрию можно добавить виртуальные события «Старт»/«Финиш» (они
    // расширяют полотно), не меняя число плотности в счётчике качества.
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinY = Infinity;
    let bMaxY = -Infinity;
    for (const n of nodes) {
        const p = layout.pos[n.id];
        if (!p)
            continue;
        if (p[0] - exports.CARD_W / 2 < bMinX)
            bMinX = p[0] - exports.CARD_W / 2;
        if (p[0] + exports.CARD_W / 2 > bMaxX)
            bMaxX = p[0] + exports.CARD_W / 2;
        if (p[1] - exports.CARD_H / 2 < bMinY)
            bMinY = p[1] - exports.CARD_H / 2;
        if (p[1] + exports.CARD_H / 2 > bMaxY)
            bMaxY = p[1] + exports.CARD_H / 2;
    }
    const bboxW = Number.isFinite(bMinX) ? bMaxX - bMinX : layout.maxX - layout.minX;
    const bboxH = Number.isFinite(bMinY) ? bMaxY - bMinY : layout.maxY - layout.minY;
    const bboxArea = Math.max(1, bboxW) * Math.max(1, bboxH);
    const nodeArea = rects.length * exports.CARD_W * exports.CARD_H;
    const density = round1((nodeArea / bboxArea) * 100);
    return { crossings, edgeNodeHits, nodeOverlaps, density, nodes: vis.length, edges: edges.length };
}
