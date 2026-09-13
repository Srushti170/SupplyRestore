"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { divIcon, latLngBounds, type LatLngExpression } from "leaflet";

type WarehousePoint = { id: number; name: string; location: string };
type AgentEvent = { type: string; content: { tool?: string; output?: Record<string, unknown> } };

type Props = {
  warehouses: WarehousePoint[];
  activeWarehouseId: number | null;
  sourceWarehouse?: WarehousePoint | null;
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
  };
};

const CITY_COORDS: Record<string, [number, number]> = {
  // Major Indian warehouse and logistics locations. Users may also enter exact "lat, lng" coordinates.
  mumbai: [19.076, 72.8777], bombay: [19.076, 72.8777],
  nagpur: [21.1458, 79.0882], pune: [18.5204, 73.8567],
  kolkata: [22.5726, 88.3639], calcutta: [22.5726, 88.3639],
  delhi: [28.6139, 77.209], "new delhi": [28.6139, 77.209], gurugram: [28.4595, 77.0266], gurgaon: [28.4595, 77.0266], noida: [28.5355, 77.391],
  bengaluru: [12.9716, 77.5946], bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867], chennai: [13.0827, 80.2707],
  ahmedabad: [23.0225, 72.5714], surat: [21.1702, 72.8311],
  nashik: [19.9975, 73.7898], indore: [22.7196, 75.8577], jaipur: [26.9124, 75.7873], udaipur: [24.5854, 73.7125], jodhpur: [26.2389, 73.0243],
  prayagraj: [25.4358, 81.8463], allahabad: [25.4358, 81.8463], lucknow: [26.8467, 80.9462], kanpur: [26.4499, 80.3319], varanasi: [25.3176, 82.9739], agra: [27.1767, 78.0081],
  patna: [25.5941, 85.1376], ranchi: [23.3441, 85.3096], bhubaneswar: [20.2961, 85.8245], cuttack: [20.4625, 85.883],
  guwahati: [26.1445, 91.7362], assam: [26.2006, 92.9376], sikkim: [27.3389, 88.6065], gangtok: [27.3389, 88.6065], siliguri: [26.7271, 88.3953],
  kochi: [9.9312, 76.2673], cochin: [9.9312, 76.2673], thiruvananthapuram: [8.5241, 76.9366], trivandrum: [8.5241, 76.9366],
  coimbatore: [11.0168, 76.9558], madurai: [9.9252, 78.1198], visakhapatnam: [17.6868, 83.2185], vizag: [17.6868, 83.2185], vijayawada: [16.5062, 80.648],
  bhopal: [23.2599, 77.4126], raipur: [21.2514, 81.6296], vadodara: [22.3072, 73.1812], rajkot: [22.3039, 70.8022],
  chandigarh: [30.7333, 76.7794], ludhiana: [30.901, 75.8573], amritsar: [31.634, 74.8723], dehradun: [30.3165, 78.0322],
  faridabad: [28.4089, 77.3178], meerut: [28.9845, 77.7064], jamnagar: [22.4707, 70.0577],
};

function resolveLocation(location: string): [number, number] {
  const coordinateMatch = location.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (coordinateMatch) return [Number(coordinateMatch[1]), Number(coordinateMatch[2])];
  const normalized = location.toLowerCase();
  const city = Object.keys(CITY_COORDS).find(name => normalized.includes(name));
  if (city) {
    const [lat, lng] = CITY_COORDS[city];
    return [lat, lng];
  }
  return [19.076, 72.8777];
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

export default function LiveNetworkMap({ warehouses, activeWarehouseId, sourceWarehouse, events, runStatus, labels }: Props) {
  const active = warehouses.find(item => item.id === activeWarehouseId) || warehouses[0];
  const warehousePoints = useMemo(() => warehouses.map(warehouse => ({ ...warehouse, coords: resolveLocation(warehouse.location) })), [warehouses]);
  const target = warehousePoints.find(item => item.id === active?.id) || warehousePoints[0];
  const targetCoords: [number, number] = target?.coords || CITY_COORDS.mumbai;
  const targetLocation = target?.location.toLowerCase() || "mumbai";
  const reserveCity = sourceWarehouse?.location || (targetLocation.includes("nagpur") ? "Mumbai" : "Nagpur");
  const rapidCity = targetLocation.includes("pune") ? "Mumbai" : "Pune";
  const budgetCity = targetLocation.includes("kolkata") || targetLocation.includes("calcutta") ? "Mumbai" : "Kolkata";
  const reserveCoords: [number, number] = resolveLocation(reserveCity);
  const rapidSupplier: [number, number] = CITY_COORDS[rapidCity.toLowerCase()];
  const budgetSupplier: [number, number] = CITY_COORDS[budgetCity.toLowerCase()];
  const transferStarted = events.some(event => event.content.tool === "transfer_inventory");
  const routeClosed = events.some(event => event.type === "disruption");
  const purchaseStarted = events.some(event => event.content.tool === "create_purchase_order");
  const verified = runStatus === "verified";
  const selectedRoute = purchaseStarted ? "R-VN" : "R-SN";
  const activeLine = purchaseStarted ? [rapidSupplier, targetCoords] : [reserveCoords, targetCoords];
  const latestTransit = [...events].reverse().find(event => event.type === "transit" && event.content.output?.route_id === selectedRoute);
  const progress = latestTransit ? Math.max(0, Math.min(100, Number(latestTransit.content.output?.progress || 0))) : 0;
  const moving = runStatus === "running" && (transferStarted || purchaseStarted);
  const truckPosition: [number, number] = [activeLine[0][0] + (activeLine[1][0] - activeLine[0][0]) * progress / 100, activeLine[0][1] + (activeLine[1][1] - activeLine[0][1]) * progress / 100];
  const allPoints = useMemo<LatLngExpression[]>(() => [...warehousePoints.map(item => item.coords), reserveCoords, rapidSupplier, budgetSupplier], [warehousePoints, reserveCoords, rapidSupplier, budgetSupplier]);

  return <div className="relative h-[330px] overflow-hidden bg-[#07110e]">
    <MapContainer center={targetCoords} zoom={6} zoomControl={false} attributionControl={true} className="h-full w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitNetwork points={allPoints} />

      <Polyline positions={[reserveCoords, targetCoords]} pathOptions={{ color: routeClosed ? "#ef5f5f" : transferStarted ? "#43e49a" : "#78958a", weight: transferStarted ? 5 : 3, opacity: .9, dashArray: routeClosed ? "10 9" : transferStarted ? "14 8" : "5 8", className: transferStarted && !routeClosed ? "network-route-active" : "" }}>
        <Tooltip sticky>{sourceWarehouse?.name || "Reserve warehouse"} → {target?.name || "Destination"} · {routeClosed ? labels.closed : transferStarted ? labels.selected : labels.available}</Tooltip>
      </Polyline>
      <Polyline positions={[rapidSupplier, targetCoords]} pathOptions={{ color: purchaseStarted ? "#43e49a" : "#788bce", weight: purchaseStarted ? 5 : 2.5, opacity: purchaseStarted ? 1 : .65, dashArray: purchaseStarted ? "14 8" : "5 8", className: purchaseStarted ? "network-route-active" : "" }}>
        <Tooltip sticky>RapidSupply → {target?.name || "Destination"} · {purchaseStarted ? labels.selected : labels.available}</Tooltip>
      </Polyline>

      {warehousePoints.map(warehouse => <CircleMarker key={warehouse.id} center={warehouse.coords} radius={warehouse.id === target?.id ? 10 : 7} pathOptions={{ color: warehouse.id === target?.id ? "#052117" : "#93c5fd", fillColor: warehouse.id === target?.id ? "#56e39a" : "#3b82f6", fillOpacity: 1, weight: warehouse.id === target?.id ? 4 : 2 }}><Tooltip direction="top" permanent offset={[0, -9]} className="warehouse-map-label">{warehouse.name} · {warehouse.location}</Tooltip><Popup><strong>{warehouse.name}</strong><br />{warehouse.location}<br />{warehouse.id === target?.id ? labels.active : labels.warehouse}</Popup></CircleMarker>)}
      {!sourceWarehouse || !warehouses.some(warehouse => warehouse.id === sourceWarehouse.id) ? <CircleMarker center={reserveCoords} radius={7} pathOptions={{ color: "#b8d3ff", fillColor: "#3b82f6", fillOpacity: 1, weight: 2 }}><Tooltip direction="top">{sourceWarehouse?.name || "External Reserve Hub"} · {reserveCity}</Tooltip></CircleMarker> : null}
      <CircleMarker center={rapidSupplier} radius={7} pathOptions={{ color: "#e9d5ff", fillColor: "#a855f7", fillOpacity: 1, weight: 2 }}><Tooltip direction="top">RapidSupply · {rapidCity}<br />{labels.supplier}</Tooltip></CircleMarker>
      <CircleMarker center={budgetSupplier} radius={6} pathOptions={{ color: "#e9d5ff", fillColor: "#7e22ce", fillOpacity: .9, weight: 2 }}><Tooltip direction="top">ValueSource · {budgetCity}<br />{labels.supplier}</Tooltip></CircleMarker>
      {moving && <Marker position={truckPosition} icon={truckIcon}><Popup>{labels.selected}<br />{progress}%</Popup></Marker>}
      {verified && <Marker position={targetCoords} icon={checkIcon}><Tooltip direction="right">{labels.verified}</Tooltip></Marker>}
    </MapContainer>
    <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-[#315144] bg-[#07120ee8] px-3 py-2 text-[9px] font-semibold text-[#a7bcb2] shadow-lg"><span className="mr-2 inline-block h-2 w-5 rounded bg-[#43e49a]" />{labels.selected}<span className="mx-2 text-[#365146]">|</span><span className="mr-2 inline-block w-5 border-t-2 border-dashed border-red-400" />{labels.closed}</div>
  </div>;
}
