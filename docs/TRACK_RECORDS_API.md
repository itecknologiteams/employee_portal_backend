# Track Records API

Requisition records with current status – use either **all records** or **by employee**.  
Both endpoints support **pagination**. Filter query params can be added later (e.g. `status`, `from`, `to`, `referenceNo`).

Base URL (local): `http://localhost:4000/api/requisition`

---

## Pagination (both endpoints)

| Param  | Default | Description        |
|--------|--------|--------------------|
| `page` | 1      | Page number        |
| `limit`| 20     | Items per page (max 100) |

Response includes `data` (array) and `pagination`: `{ page, limit, total, totalPages }`.

---

## 1. All track records (no employeeId)

Returns all requisitions with status and creator info. Use for admin/report view.

**Endpoint:** `GET /api/requisition/track-records`

**cURL:**
```bash
curl -s -X GET "http://localhost:4000/api/requisition/track-records"
curl -s -X GET "http://localhost:4000/api/requisition/track-records?page=1&limit=10"
```

**Response:**
```json
{
  "data": [
    {
      "requisitionId": 1,
      "referenceNo": "REQ-20250204-00001",
      "employeeId": 5,
      "creatorName": "John Doe",
      "creatorEmail": "john@example.com",
      "departmentName": "IT",
      "createdAt": "2025-02-04T10:00:00.000Z",
      "requiredByDate": "2025-02-15",
      "status": "Pending Committee",
      "pendingAt": "Committee",
      "isRejected": false,
      "itemCount": 2
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
}
```

---

## 2. Track records by employee (with employeeId)

Returns requisitions for a specific employee. Use for “my cases” view.

**Endpoint:** `GET /api/requisition/track-records/:employeeId`

**cURL:**
```bash
curl -s -X GET "http://localhost:4000/api/requisition/track-records/5"
curl -s -X GET "http://localhost:4000/api/requisition/track-records/5?page=1&limit=10"
```

Replace `5` with the required employee ID.

**Response:**
```json
{
  "data": [
    {
      "requisitionId": 1,
      "referenceNo": "REQ-20250204-00001",
      "employeeId": 5,
      "createdAt": "2025-02-04T10:00:00.000Z",
      "requiredByDate": "2025-02-15",
      "status": "Pending Committee",
      "pendingAt": "Committee",
      "isRejected": false,
      "itemCount": 2
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 7, "totalPages": 1 }
}
```

**Adding filters later:** use query params on the same URL (e.g. `?status=Pending HOD&from=2025-01-01&to=2025-02-01`). Backend can extend the `WHERE` clause and keep the same `COUNT` + `LIMIT/OFFSET` pattern.

---

## Fields

| Field           | Description |
|----------------|-------------|
| `requisitionId` | Requisition ID |
| `referenceNo`   | e.g. REQ-20250204-00001 |
| `employeeId`   | Creator employee ID |
| `creatorName`  | Only in “all” endpoint |
| `creatorEmail` | Only in “all” endpoint |
| `departmentName` | Only in “all” endpoint |
| `createdAt`    | When requisition was created |
| `requiredByDate` | Required-by date |
| `status`       | Full status text (e.g. Pending Committee) |
| `pendingAt`    | Short stage: HOD, Committee, CEO, Procurement, Finance, Completed, Rejected |
| `isRejected`   | true if rejected |
| `itemCount`    | Number of items in the requisition |
