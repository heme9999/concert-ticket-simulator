import React, { useMemo, useRef } from 'react';
import { findSpatialCandidate, isArrowDirection } from '@/lib/spatialNav';
import type {
  PracticeMission,
  SeatNode,
  SeatVisualStatus,
  SectionId,
} from '@/lib/types';
import { DEMO_VENUE } from '@/lib/venue';

export type MapZoomTarget = 'ALL' | SectionId;

interface SeatMapSvgProps {
  mission: PracticeMission;
  selectedSeatIds: readonly string[];
  lockedSeatIds: ReadonlySet<string>;
  conflictSeatIds: ReadonlySet<string>;
  focusedSeatId: string;
  zoomTarget: MapZoomTarget;
  zoomScale: number;
  disabled: boolean;
  onFocusSeat: (seatId: string) => void;
  onSelectSeat: (seatId: string) => void;
  onZoomSection: (target: MapZoomTarget) => void;
}

function computeViewBox(zoomTarget: MapZoomTarget, zoomScale: number): string {
  const baseBoxStr =
    zoomTarget === 'ALL'
      ? DEMO_VENUE.viewBox
      : DEMO_VENUE.sections.find((s) => s.id === zoomTarget)?.zoomViewBox ??
        DEMO_VENUE.viewBox;

  const parts = baseBoxStr.split(' ').map(Number);
  const bx = parts[0] ?? 0;
  const by = parts[1] ?? 0;
  const bw = parts[2] ?? DEMO_VENUE.width;
  const bh = parts[3] ?? DEMO_VENUE.height;

  if (zoomScale <= 1) {
    return `${bx} ${by} ${bw} ${bh}`;
  }

  const nw = bw / zoomScale;
  const nh = bh / zoomScale;
  const nx = bx + (bw - nw) / 2;
  const ny = by + (bh - nh) / 2;
  return `${nx.toFixed(1)} ${ny.toFixed(1)} ${nw.toFixed(1)} ${nh.toFixed(1)}`;
}

function getSeatVisualStatus(
  seat: SeatNode,
  selectedSet: ReadonlySet<string>,
  lockedSeatIds: ReadonlySet<string>,
  conflictSeatIds: ReadonlySet<string>,
  mission: PracticeMission,
): SeatVisualStatus {
  if (selectedSet.has(seat.id)) return 'selected';
  if (conflictSeatIds.has(seat.id)) return 'conflict_lost';
  if (lockedSeatIds.has(seat.id)) return 'unavailable';
  if (seat.price > mission.maxPerTicket) return 'over_budget';
  return 'available';
}

export const SeatMapSvg: React.FC<SeatMapSvgProps> = ({
  mission,
  selectedSeatIds,
  lockedSeatIds,
  conflictSeatIds,
  focusedSeatId,
  zoomTarget,
  zoomScale,
  disabled,
  onFocusSeat,
  onSelectSeat,
  onZoomSection,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const selectedSet = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);
  const activeViewBox = useMemo(
    () => computeViewBox(zoomTarget, zoomScale),
    [zoomTarget, zoomScale],
  );

  const handleGridKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const key = event.key;

    if (isArrowDirection(key)) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const activeEl = document.activeElement;
      const currentCell =
        activeEl instanceof SVGElement &&
        activeEl.getAttribute('data-seat-cell') === 'true'
          ? activeEl
          : svgRef.current.querySelector<SVGElement>('[data-seat-cell="true"][tabindex="0"]');

      if (!currentCell) return;

      const candidate = findSpatialCandidate(svgRef.current, currentCell, key);
      if (!candidate) {
        // Preserve native viewport scrolling at widget boundaries
        return;
      }

      event.preventDefault();
      const nextId = candidate.getAttribute('data-seat-id');
      if (nextId) {
        onFocusSeat(nextId);
      }
      candidate.focus();
      candidate.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }

    if (key === 'Enter' || key === ' ') {
      const target = event.target;
      if (
        target instanceof SVGElement &&
        target.getAttribute('data-seat-cell') === 'true'
      ) {
        event.preventDefault();
        const seatId = target.getAttribute('data-seat-id');
        if (seatId && !disabled) {
          onSelectSeat(seatId);
        }
      }
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/15 bg-[#090d16] shadow-2xl">
      <svg
        ref={svgRef}
        role="grid"
        aria-label="Interactive Starlight Civic Arena demo seating chart. Use arrow keys to move between seats and Enter or Space to toggle selection."
        viewBox={activeViewBox}
        onKeyDown={handleGridKeyDown}
        className="block h-auto w-full select-none touch-manipulation"
        style={{
          minHeight: zoomTarget === 'ALL' ? '240px' : '170px',
          maxHeight: '560px',
        }}
      >
        <defs>
          <radialGradient id="stage-glow" cx="50%" cy="0%" r="70%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.42" />
            <stop offset="55%" stopColor="#0ea5e9" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#090d16" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="stage-bar" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#312e81" />
            <stop offset="50%" stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>
          <pattern
            id="seat-hatch"
            width="6"
            height="6"
            patternTransform="rotate(45 0 0)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill="#1e293b" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Concert spotlight backdrop */}
        <rect x="0" y="0" width={DEMO_VENUE.width} height={DEMO_VENUE.height} fill="url(#stage-glow)" />

        {/* Stage header */}
        <g aria-hidden="true">
          <rect
            x="230"
            y="18"
            width="500"
            height="62"
            rx="16"
            fill="url(#stage-bar)"
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1.5"
          />
          <text
            x="480"
            y="46"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="16"
            fontWeight="800"
            letterSpacing="2.4"
          >
            STAGE · DEMO ARENA
          </text>
          <text
            x="480"
            y="66"
            textAnchor="middle"
            fill="#cbd5e1"
            fontSize="11"
            fontWeight="600"
          >
            Fictional venue map — click any section label or pill above to zoom
          </text>
        </g>

        {/* Sections */}
        {DEMO_VENUE.sections.map((section) => {
          const isPreferred = mission.preferredSections.includes(section.id);
          const isBackup = mission.backupSections.includes(section.id);
          const isOverBudgetSection = section.basePrice > mission.maxPerTicket;

          const badgeText = isPreferred
            ? 'TARGET ZONE'
            : isBackup
              ? 'BACKUP ZONE'
              : isOverBudgetSection
                ? 'OVER BUDGET'
                : 'ALT ZONE';
          const badgeFill = isPreferred
            ? '#065f46'
            : isBackup
              ? '#1e3a8a'
              : isOverBudgetSection
                ? '#78350f'
                : '#334155';
          const badgeStroke = isPreferred
            ? '#34d399'
            : isBackup
              ? '#60a5fa'
              : isOverBudgetSection
                ? '#fbbf24'
                : '#64748b';

          const { x, y, width, height } = section.box;
          const sectionSeats = DEMO_VENUE.seats.filter((s) => s.sectionId === section.id);
          const seat4 = sectionSeats.find((s) => s.row === 1 && s.seatNumber === 4);
          const seat5 = sectionSeats.find((s) => s.row === 1 && s.seatNumber === 5);
          const aisleCenterX =
            seat4 && seat5 ? (seat4.x + seat4.width + seat5.x) / 2 : x + width / 2;

          return (
            <g key={section.id} role="rowgroup" aria-label={section.name}>
              {/* Section shell */}
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx="14"
                fill="rgba(15, 23, 42, 0.88)"
                stroke={
                  zoomTarget === section.id
                    ? '#38bdf8'
                    : isPreferred
                      ? 'rgba(52, 211, 153, 0.45)'
                      : 'rgba(148, 163, 184, 0.28)'
                }
                strokeWidth={zoomTarget === section.id ? '2.5' : '1.5'}
              />

              {/* Section title + clickable zoom target */}
              <g
                onClick={() =>
                  onZoomSection(zoomTarget === section.id ? 'ALL' : section.id)
                }
                style={{ cursor: 'pointer' }}
              >
                <text
                  x={x + 14}
                  y={y + 20}
                  fill="#f8fafc"
                  fontSize="13"
                  fontWeight="750"
                >
                  {section.shortLabel} · ${section.basePrice}/ea
                </text>
                <rect
                  x={x + width - 104}
                  y={y + 6}
                  width="92"
                  height="19"
                  rx="9.5"
                  fill={badgeFill}
                  stroke={badgeStroke}
                  strokeWidth="1"
                />
                <text
                  x={x + width - 58}
                  y={y + 19}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="9.5"
                  fontWeight="700"
                  letterSpacing="0.5"
                >
                  {badgeText}
                </text>
              </g>

              {/* Center walkway AISLE indicator */}
              <g aria-hidden="true">
                <rect
                  x={aisleCenterX - 11}
                  y={y + 30}
                  width="22"
                  height={height - 38}
                  rx="4"
                  fill="rgba(255, 255, 255, 0.04)"
                  stroke="rgba(255, 255, 255, 0.14)"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={aisleCenterX}
                  y={y + height / 2 + 12}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="8.5"
                  fontWeight="700"
                  letterSpacing="1.2"
                  transform={`rotate(-90 ${aisleCenterX} ${y + height / 2 + 12})`}
                >
                  AISLE
                </text>
              </g>

              {/* Row labels R1, R2, R3 */}
              {[1, 2, 3].map((row) => {
                const firstSeatInRow = sectionSeats.find(
                  (s) => s.row === row && s.seatNumber === 1,
                );
                if (!firstSeatInRow) return null;
                return (
                  <text
                    key={`${section.id}-row-${row}`}
                    x={x + 16}
                    y={firstSeatInRow.y + firstSeatInRow.height / 2 + 4}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10.5"
                    fontWeight="700"
                  >
                    R{row}
                  </text>
                );
              })}

              {/* Interactive seat cells */}
              {sectionSeats.map((seat) => {
                const status = getSeatVisualStatus(
                  seat,
                  selectedSet,
                  lockedSeatIds,
                  conflictSeatIds,
                  mission,
                );
                const isSelected = status === 'selected';
                const isUnavailable =
                  status === 'unavailable' || status === 'conflict_lost';
                const isOverBudget = status === 'over_budget';

                let fill = '#0f2942';
                let stroke = '#38bdf8';
                let strokeDash: string | undefined;
                let textColor = '#e0f2fe';

                if (isSelected) {
                  fill = '#10b981';
                  stroke = '#ecfdf5';
                  textColor = '#052e16';
                } else if (status === 'conflict_lost') {
                  fill = '#4c0519';
                  stroke = '#fb7185';
                  strokeDash = '4 2';
                  textColor = '#fecdd3';
                } else if (status === 'unavailable') {
                  fill = 'url(#seat-hatch)';
                  stroke = '#475569';
                  textColor = '#64748b';
                } else if (isOverBudget) {
                  fill = '#2a1c08';
                  stroke = '#f59e0b';
                  strokeDash = '4 2';
                  textColor = '#fde68a';
                }

                const statusLabel =
                  status === 'selected'
                    ? 'selected'
                    : status === 'conflict_lost'
                      ? 'unavailable, lost during live demand'
                      : status === 'unavailable'
                        ? 'unavailable'
                        : status === 'over_budget'
                          ? 'available, exceeds per-ticket virtual budget'
                          : 'available';

                const aisleHint =
                  seat.seatNumber === 4
                    ? ', left of center aisle'
                    : seat.seatNumber === 5
                      ? ', right of center aisle'
                      : '';

                return (
                  <g
                    key={seat.id}
                    role="gridcell"
                    data-seat-cell="true"
                    data-seat-id={seat.id}
                    data-selected={isSelected ? 'true' : 'false'}
                    data-status={status}
                    tabIndex={focusedSeatId === seat.id ? 0 : -1}
                    aria-selected={isSelected}
                    aria-disabled={isUnavailable || disabled ? 'true' : undefined}
                    aria-label={`${section.name}, Row ${seat.row}, Seat ${seat.seatNumber}, $${seat.price}, ${statusLabel}${aisleHint}`}
                    className="seat-node"
                    onClick={() => {
                      onFocusSeat(seat.id);
                      if (!disabled) {
                        onSelectSeat(seat.id);
                      }
                    }}
                  >
                    {/* Keyboard focus halo */}
                    <rect
                      x={seat.x - 3}
                      y={seat.y - 3}
                      width={seat.width + 6}
                      height={seat.height + 6}
                      rx="9"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="2.2"
                      className="seat-focus-ring opacity-0 transition-opacity"
                    />

                    {/* Main seat chip */}
                    <rect
                      x={seat.x}
                      y={seat.y}
                      width={seat.width}
                      height={seat.height}
                      rx="7"
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSelected ? '2.2' : '1.4'}
                      strokeDasharray={strokeDash}
                    />

                    {/* Seat number */}
                    <text
                      x={seat.x + seat.width / 2}
                      y={seat.y + seat.height / 2 + 4}
                      textAnchor="middle"
                      fill={textColor}
                      fontSize="11.5"
                      fontWeight="800"
                    >
                      {seat.seatNumber}
                    </text>

                    {/* Non-color status glyphs */}
                    {isSelected && (
                      <g aria-hidden="true">
                        <circle cx={seat.x + seat.width - 5} cy={seat.y + 5} r="5.5" fill="#ecfdf5" />
                        <path
                          d={`M${seat.x + seat.width - 7.8} ${seat.y + 5.1} L${seat.x + seat.width - 5.6} ${seat.y + 7.2} L${seat.x + seat.width - 2.4} ${seat.y + 3.2}`}
                          fill="none"
                          stroke="#065f46"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </g>
                    )}

                    {isOverBudget && !isSelected && (
                      <text
                        x={seat.x + seat.width - 5}
                        y={seat.y + 9}
                        textAnchor="middle"
                        fill="#fbbf24"
                        fontSize="8.5"
                        fontWeight="900"
                        aria-hidden="true"
                      >
                        $!
                      </text>
                    )}

                    {status === 'unavailable' && (
                      <text
                        x={seat.x + seat.width - 6}
                        y={seat.y + 9}
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="8.5"
                        fontWeight="800"
                        aria-hidden="true"
                      >
                        ×
                      </text>
                    )}

                    {status === 'conflict_lost' && (
                      <g aria-hidden="true">
                        <circle cx={seat.x + seat.width - 5} cy={seat.y + 5} r="5.5" fill="#f43f5e" />
                        <text
                          x={seat.x + seat.width - 5}
                          y={seat.y + 8}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="8.5"
                          fontWeight="900"
                        >
                          !
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
