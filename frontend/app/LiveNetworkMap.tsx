"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { divIcon, latLngBounds, type LatLngExpression } from "leaflet";

type WarehousePoint = { id: number; name: string; location: string };
type AgentEvent = { type: string; content: { tool?: string } };

type Props = {
  warehouses: WarehousePoint[];
  activeWarehouseId: number | null;
  events: AgentEvent[];
  runStatus?: string;
  labels: {
    active: string;
    warehouse: string;
    supplier: string;
    available: string;
    selected: string;
    closed: string;
    verified: string;
    simulated: string;
  };
};

const CITY_COORDS: Record<string, [number, number]> = {
  mumbai: [19.076, 72.8777], bombay: [19.076, 72.8777],
  nagpur: [21.1458, 79.0882], pune: [18.5204, 73.8567],
  kolkata: [22.5726, 88.3639], calcutta: [22.5726, 88.3639],
  delhi: [28.6139, 77.209], bengaluru: [12.9716, 77.5946], bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867], chennai: [13.0827, 80.2707],
  ahmedabad: [23.0225, 72.5714], surat: [21.1702, 72.8311],
  nashik: [19.9975, 73.7898], indore: [22.7196, 75.8577],
};

function resolveLocation(location: string, index = 0): [number, number] {
  const coordinateMatch = location.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coordinateMatch) return [Number(coordinateMatch[1]), Number(coordinateMatch[2])];
  const normalized = location.toLowerCase();
  const city = Object.keys(CITY_COORDS).find(name => normalized.includes(name));
  if (city) {
    const [lat, lng] = CITY_COORDS[city];
    return [lat + index * 0.025, lng + index * 0.025];
  }
  return [19.076 + index * 0.04, 72.8777 + index * 0.04];
}

function FitNetwork({ points }: { points: LatLngExpression[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(latLngBounds(points), { padding: [38, 38], maxZoom: 7 });
    else if (points.length === 1) map.setView(points[0], 7);
  }, [map, points]);
  return null;
}

const truckIcon = divIcon({ className: "network-truck", html: "<span>🚚</span>", iconSize: [28, 28], iconAnchor: [14, 14] });
const checkIcon = divIcon({ className: "network-check", html: "<span>✓</span>", iconSize: [26, 26], iconAnchor: [13, 13] });

export default function LiveNetworkMap({ warehouses, activeWarehouseId, events, runStatus, labels }: Props) {
  const active = warehouses.find(item => item.id === activeWarehouseId) || warehouses[0];
  const warehousePoints = useMemo(() => warehouses.map((warehouse, index) => ({ ...warehouse, coords: resolveLocation(warehouse.location, index) })), [warehouses]);
  const target = warehousePoints.find(item => item.id === active?.id) || warehousePoints[0];
  const targetCoords: [number, number] = target?.coords || CITY_COORDS.mumbai;
  const targetLocation = target?.location.toLowerCase() || "mumbai";
  const reserveCity = targetLocation.includes("nagpur") ? "Mumbai" : "Nagpur";
  const rapidCity = targetLocation.includes("pune") ? "Mumbai" : "Pune";
  const budgetCity = targetLocation.includes("kolkata") || targetLocation.includes("calcutta") ? "Mumbai" : "Kolkata";
  const reserveCoords: [number, number] = CITY_COORDS[reserveCity.toLowerCase()];
  const rapidSupplier: [number, number] = CITY_COORDS[rapidCity.toLowerCase()];
  const budgetSupplier: [number, number] = CITY_COORDS[budgetCity.toLowerCase()];
  const transferStarted = events.some(event => event.content.tool === "transfer_inventory");
  const routeClosed = events.some(event => event.type === "disruption");
  const purchaseStarted = events.some(event => event.content.tool === "create_purchase_order");
  const verified = runStatus === "verified";
  const activeLine = purchaseStarted ? [rapidSupplier, targetCoords] : [reserveCoords, targetCoords];
  const moving = runStatus === "running" && (transferStarted || purchaseStarted) && !(routeClosed && !purchaseStarted);
  const midpoint: [number, number] = [(activeLine[0][0] + activeLine[1][0]) / 2, (activeLine[0][1] + activeLine[1][1]) / 2];
  const allPoints = useMemo<LatLngExpression[]>(() => [...warehousePoints.map(item => item.coords), reserveCoords, rapidSupplier, budgetSupplier], [warehousePoints, reserveCoords, rapidSupplier, budgetSupplier]);

  return <div className="relative h-[330px] overflow-hidden bg-[#07110e]">
    <MapContainer center={targetCoords} zoom={6} zoomControl={false} attributionControl={true} className="h-full w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitNetwork points={allPoints} />

      <Polyline positions={[reserveCoords, targetCoords]} pathOptions={{ color: routeClosed ? "#ef5f5f" : transferStarted ? "#43e49a" : "#78958a", weight: transferStarted ? 5 : 3, opacity: .9, dashArray: routeClosed ? "10 9" : transferStarted ? "14 8" : "5 8", className: transferStarted && !routeClosed ? "network-route-active" : "" }}>
        <Tooltip sticky>R-SN · {routeClosed ? labels.closed : transferStarted ? labels.selected : labels.available}</Tooltip>
      </Polyline>
      <Polyline positions={[rapidSupplier, targetCoords]} pathOptions={{ color: purchaseStarted ? "#43e49a" : "#788bce", weight: purchaseStarted ? 5 : 2.5, opacity: purchaseStarted ? 1 : .65, dashArray: purchaseStarted ? "14 8" : "5 8", className: purchaseStarted ? "network-route-active" : "" }}>
        <Tooltip sticky>R-VN · {purchaseStarted ? labels.selected : labels.available}</Tooltip>
      </Polyline>

      {warehousePoints.map(warehouse => <CircleMarker key={warehouse.id} center={warehouse.coords} radius={warehouse.id === target?.id ? 10 : 7} pathOptions={{ color: warehouse.id === target?.id ? "#052117" : "#93c5fd", fillColor: warehouse.id === target?.id ? "#56e39a" : "#3b82f6", fillOpacity: 1, weight: warehouse.id === target?.id ? 4 : 2 }}><Popup><strong>{warehouse.name}</strong><br />{warehouse.location}<br />{warehouse.id === target?.id ? labels.active : labels.warehouse}</Popup></CircleMarker>)}
      <CircleMarker center={reserveCoords} radius={7} pathOptions={{ color: "#b8d3ff", fillColor: "#3b82f6", fillOpacity: 1, weight: 2 }}><Tooltip direction="top">South Reserve Hub · {reserveCity}</Tooltip></CircleMarker>
      <CircleMarker center={rapidSupplier} radius={7} pathOptions={{ color: "#e9d5ff", fillColor: "#a855f7", fillOpacity: 1, weight: 2 }}><Tooltip direction="top">RapidSupply · {rapidCity}<br />{labels.supplier}</Tooltip></CircleMarker>
      <CircleMarker center={budgetSupplier} radius={6} pathOptions={{ color: "#e9d5ff", fillColor: "#7e22ce", fillOpacity: .9, weight: 2 }}><Tooltip direction="top">ValueSource · {budgetCity}<br />{labels.supplier}</Tooltip></CircleMarker>
      {moving && <Marker position={midpoint} icon={truckIcon}><Tooltip permanent direction="top" offset={[0, -13]}>{labels.selected}</Tooltip></Marker>}
      {verified && <Marker position={targetCoords} icon={checkIcon}><Tooltip direction="right">{labels.verified}</Tooltip></Marker>}
    </MapContainer>
    <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-[#315144] bg-[#07120ee8] px-3 py-2 text-[9px] font-semibold text-[#a7bcb2] shadow-lg"><span className="mr-2 inline-block h-2 w-5 rounded bg-[#43e49a]" />{labels.selected}<span className="mx-2 text-[#365146]">|</span><span className="mr-2 inline-block w-5 border-t-2 border-dashed border-red-400" />{labels.closed}</div>
    <div className="pointer-events-none absolute bottom-6 left-3 z-[500] max-w-[260px] rounded-md bg-[#07120edb] px-2.5 py-1.5 text-[9px] leading-3 text-[#80998e]">{labels.simulated}</div>
  </div>;
}
