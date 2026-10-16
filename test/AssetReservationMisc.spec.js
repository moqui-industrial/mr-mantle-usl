// Assets, reservations, issuance and physical inventory (mantle.product.AssetServices) beyond what the order flows
// call. Receives its own inventory of a demo product into ZIRET_WH. New spec, no Groovy original.
const effectiveTime = Date.now()
const facilityId = "ZIRET_WH", ownerPartyId = "ORG_ZIZI_RETAIL", productId = "DEMO_2_1"
let assetId, orderId, partSeqId, itemSeqId, reservationId

spec({
    dependsOn: ["OrderToCashBasicFlow"],
    stepwise: true,
    tempSequences: { start: 57600, banks: { "mantle.order.OrderHeader": 20, "mantle.product.asset.Asset": 20, "mantle.product.asset.AssetDetail": 60,
        "mantle.product.issuance.AssetReservation": 20, "mantle.product.issuance.AssetIssuance": 20, "mantle.product.receipt.AssetReceipt": 10,
        "mantle.shipment.Shipment": 10, "mantle.shipment.ShipmentItemSource": 10, "mantle.account.invoice.Invoice": 10,
        "mantle.ledger.transaction.AcctgTrans": 40, "mantle.product.asset.PhysicalInventory": 10, "mantle.product.asset.PhysicalInventoryCount": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const asset = (id) => ec.entity.find("mantle.product.asset.Asset").condition("assetId", id).one()
const reservations = (id) => Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("assetId", id).list())

feature("receive an asset, update it, and read its display info and the available inventory", {
    when() {
        assetId = call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 20, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory",
                acquireCost: 3, receivedDate: effectiveTime }).assetId
        const before = call("mantle.product.AssetServices.get#AvailableInventory", { productId, facilityId })
        call("mantle.product.AssetServices.update#Asset", { assetId, assetName: "Receiving test asset" })
        call("mantle.product.AssetServices.update#AssetAcquireCost", { assetId, acquireCost: 4, ownerPartyId })
        call("mantle.product.AssetServices.update#ProductAcquireCost", { productId, facilityId, acquireCost: 4, ownerPartyId, receivedDate_from: effectiveTime - 1000, receivedDate_thru: effectiveTime + 1000 })
        const display = call("mantle.product.AssetServices.get#AssetDisplayInfo", { assetId })
        const multi = call("mantle.product.AssetServices.get#AvailableInventoryMulti", { productIds: [productId], facilityIds: [facilityId] })
        call("mantle.product.AssetServices.recalculate#AllAssetTotals", { facilityId, productId })
        return { before, display, multi, a: asset(assetId) }
    },
    then({ before, display, multi, a }) {
        n(a.quantityOnHandTotal) == 20
        a.assetName == "Receiving test asset"
        n(a.acquireCost) == 4
        n(before.availableToPromiseTotal) >= 20
        display.asset.assetId == assetId
        multi.availableByProductId[productId] != null
    },
})

feature("an order reserves the asset; reservations can be checked, reduced, moved and removed", {
    when() {
        const created = call("mantle.order.OrderServices.create#Order", { vendorPartyId: ownerPartyId, customerPartyId: "JoeDist", facilityId })
        orderId = created.orderId; partSeqId = created.orderPartSeqId
        itemSeqId = call("mantle.order.OrderServices.add#OrderProductQuantity", { orderId, orderPartSeqId: partSeqId, productId, quantity: 6, unitAmount: 8 }).orderItemSeqId
        call("mantle.order.OrderServices.set#OrderBillingShippingInfo", { orderId, orderPartSeqId: partSeqId, shippingPostalContactMechId: "JoeDistAddr", carrierPartyId: "_NA_", shipmentMethodEnumId: "ShMthGround" })
        call("mantle.order.OrderServices.place#Order", { orderId })
        call("mantle.order.OrderServices.approve#Order", { orderId })
        const all = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("orderId", orderId).list())
        reservationId = all[0].assetReservationId
        const forOrder = call("mantle.product.AssetServices.get#AvailableForOrder", { productId, orderId, orderPartSeqId: partSeqId })
        call("mantle.product.AssetServices.check#AssetReservations", { assetId: all[0].assetId })
        const valid = call("mantle.product.AssetServices.check#AssetReservationValid", { assetReservationId: reservationId })
        const facilityCheck = call("mantle.product.AssetServices.check#FacilityReservations", { facilityId })
        const reduced = call("mantle.product.AssetServices.reduce#AssetReservation", { assetReservationId: reservationId, quantityToDeduct: 1 })
        const afterReduce = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("assetReservationId", reservationId).list())[0]
        call("mantle.product.AssetServices.remove#OrderItemReservations", { orderId, orderItemSeqId: itemSeqId })
        const afterRemoveItem = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("orderId", orderId).list()).length
        call("mantle.product.AssetServices.checkReserve#AssetForOrderItem", { orderId, orderItemSeqId: itemSeqId })
        const reReserved = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("orderId", orderId).list()).length
        call("mantle.product.AssetServices.remove#OrderReservations", { orderId })
        const afterRemoveOrder = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("orderId", orderId).list()).length
        call("mantle.product.AssetServices.reserve#AssetsForOrder", { orderId })
        const again = Array.from(ec.entity.find("mantle.product.issuance.AssetReservation").condition("orderId", orderId).list())
        reservationId = again[0].assetReservationId
        return { all, forOrder, valid, facilityCheck, reduced, afterReduce, afterRemoveItem, reReserved, afterRemoveOrder, again }
    },
    then({ all, forOrder, valid, facilityCheck, reduced, afterReduce, afterRemoveItem, reReserved, afterRemoveOrder, again }) {
        all.length >= 1
        forOrder.availableToPromiseTotal != null
        valid.reservationInvalid != true
        facilityCheck.invalidReservationCount != null
        n(reduced.quantityDeducted) == 1
        n(afterReduce.quantity) == 5
        afterRemoveItem == 0
        reReserved >= 1
        afterRemoveOrder == 0
        again.length >= 1
    },
})

feature("move and displace reservations, re-reserve assets", {
    when() {
        const second = call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 10, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory", receivedDate: effectiveTime }).assetId
        const moved = call("mantle.product.AssetServices.move#AssetReservation", { assetReservationId: reservationId, assetId: second, quantity: 2 })
        const onSecond = reservations(second)
        const displaced = errorOf("mantle.product.AssetServices.displace#AssetReservations", { assetId: second, quantity: 1 })
        call("mantle.product.AssetServices.reReserve#Assets", { facilityId, productId })
        return { moved, second, displaced, onSecond }
    },
    then({ moved, onSecond }) {
        n(moved.quantityMoved) == 2
        onSecond.length >= 1
    },
})

feature("ship the order: issue assets, cancel an issuance, move issuances to a new shipment", {
    when() {
        const ship = call("mantle.shipment.ShipmentServices.create#OrderPartShipment", { orderId, orderPartSeqId: partSeqId, createPackage: true })
        call("mantle.shipment.ShipmentServices.pack#ShipmentProduct", { productId, quantity: 6, shipmentId: ship.shipmentId, shipmentPackageSeqId: ship.shipmentPackageSeqId })
        call("mantle.shipment.ShipmentServices.pack#Shipment", { shipmentId: ship.shipmentId })
        call("mantle.shipment.ShipmentServices.ship#Shipment", { shipmentId: ship.shipmentId })
        const issuances = Array.from(ec.entity.find("mantle.product.issuance.AssetIssuance").condition("shipmentId", ship.shipmentId).list())
        const issuance = issuances[0]
        call("mantle.product.AssetServices.update#AssetIssuedDate", { assetIssuanceId: issuance.assetIssuanceId, issuedDate: effectiveTime - 60000 })
        const dated = Array.from(ec.entity.find("mantle.product.issuance.AssetIssuance").condition("assetIssuanceId", issuance.assetIssuanceId).list())[0]
        // shipping invoiced the issuance, so it can no longer be cancelled
        const cancelled = errorOf("mantle.product.AssetServices.cancel#AssetIssuance", { assetIssuanceId: issuance.assetIssuanceId, quantityToCancel: 1 })
        return { ship, issuances: issuances.length, dated, cancelled }
    },
    then({ ship, issuances, dated, cancelled }) {
        ship.shipmentId != null
        issuances >= 1
        String(dated.issuedDate) == String(effectiveTime - 60000)
        cancelled.includes("already on invoice")
    },
})

feature("physical inventory: record a count and a change, then set the count date", {
    when() {
        const counted = call("mantle.product.AssetServices.record#PhysicalInventoryQuantity", { productId, facilityId, quantity: 15, comments: "cycle count" })
        const after = call("mantle.product.AssetServices.get#AvailableInventory", { productId, facilityId })
        const change = call("mantle.product.AssetServices.record#PhysicalInventoryChange", { productId, facilityId, quantityChange: -1, comments: "breakage" })
        return { counted, after, change }
    },
    then({ counted, after, change }) {
        counted != null
        after != null
        change != null
    },
})

feature("adjust an asset quantity directly and move an asset", {
    when() {
        const target = call("mantle.product.AssetServices.receive#Asset", { productId, quantity: 4, facilityId, ownerPartyId, assetTypeEnumId: "AstTpInventory", receivedDate: effectiveTime }).assetId
        call("mantle.product.AssetServices.change#AssetQuantity", { assetId: target, quantityDiff: -1, physicalInventoryId: null })
        const changed = asset(target)
        const adHoc = call("mantle.product.AssetServices.create#ProductAssetAdHoc", { productId, facilityId, quantityOnHandTotal: 2, availableToPromiseTotal: 2, ownerPartyId })
        return { changed, adHoc }
    },
    then({ changed, adHoc }) {
        n(changed.quantityOnHandTotal) == 3
        adHoc.assetId != null
    },
})
