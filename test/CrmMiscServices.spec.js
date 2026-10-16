// Communication events, requests, sales accounts and contacts, party duplicates, and equipment maintenance: services no
// flow reaches. New spec, no Groovy original.
const effectiveTime = Date.now()
let personId, accountId, contactId, requestId, messageId, equipmentId, productMaintenanceId

spec({
    stepwise: true,
    tempSequences: { start: 57400, banks: { "mantle.party.Party": 30, "mantle.request.Request": 10, "mantle.party.communication.CommunicationEvent": 20,
        "mantle.product.asset.Asset": 10, "mantle.product.maintenance.AssetMaintenance": 10, "mantle.party.contact.ContactMech": 30 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
const cev = (id) => ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", id).one()

feature("sales accounts and contacts", {
    when() {
        accountId = call("mantle.sales.AccountServices.create#Account", { organizationName: "CRM Account", roleTypeId: "Account" }).partyId
        contactId = call("mantle.sales.AccountServices.create#Contact", { firstName: "Connie", lastName: "Contact", accountPartyId: accountId }).partyId
        personId = call("mantle.party.PartyServices.create#Person", { firstName: "Pete", lastName: "Person" }).partyId
        call("mantle.sales.AccountServices.add#Contact", { partyId: personId, accountPartyId: accountId })
        const rels = Array.from(ec.entity.find("mantle.party.PartyRelationship").condition("toPartyId", accountId).condition("relationshipTypeEnumId", "PrtContact").list())
        const delId = rels.find(r => r.fromPartyId == personId).partyRelationshipId
        call("mantle.sales.AccountServices.delete#Contact", { partyRelationshipId: delId })
        const left = Array.from(ec.entity.find("mantle.party.PartyRelationship").condition("toPartyId", accountId).condition("relationshipTypeEnumId", "PrtContact").condition("thruDate", null).list())
        return { rels: rels.length, left: left.map(r => r.fromPartyId) }
    },
    then({ rels, left }) {
        rels == 2
        left.includes(contactId)
        !left.includes(personId)
    },
})

feature("messages, replies and finding communication events", {
    when() {
        messageId = call("mantle.party.CommunicationServices.create#Message", { fromPartyId: personId, toPartyId: contactId, subject: "Hello", body: "First message", purposeEnumId: "CpComment" }).communicationEventId
        const reply = call("mantle.party.CommunicationServices.reply#CommunicationEvent", { parentCommEventId: messageId, fromPartyId: contactId, subject: "Re: Hello", body: "Reply" })
        // the default type list "Email,Message,Comment" is also read as an equality by search-form-inputs, so a type is passed, as the screens do
        const found = call("mantle.party.CommunicationServices.find#PartyCommunicationEvents", { partyId: contactId, communicationEventTypeId: "Message" })
        const contentId = call("mantle.party.CommunicationServices.create#CommunicationEventContent", { communicationEventId: messageId, communicationContentTypeEnumId: "CecOther", description: "att" }).communicationEventContentId
        return { reply, found, contentId, parent: cev(reply.communicationEventId) }
    },
    then({ reply, found, contentId, parent }) {
        messageId != null
        reply.communicationEventId != messageId
        parent.parentCommEventId == messageId
        found.commEventList.length >= 1
        contentId != null
    },
})

feature("requests: create, update, comment, replace a party, and a contact request", {
    when() {
        requestId = call("mantle.request.RequestServices.create#Request", { requestName: "Support please", description: "Broken thing", customerPartyId: accountId, assignToPartyId: contactId }).requestId
        call("mantle.request.RequestServices.update#Request", { requestId, priority: 2, requestName: "Support now" })
        call("mantle.request.RequestServices.add#RequestComment", { requestId, subject: "Note", body: "Looking" })
        const comments = Array.from(ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", requestId).list())
        const commId = comments[0].communicationEventId
        call("mantle.request.RequestServices.update#RequestComment", { requestId, communicationEventId: commId, subject: "Note 2", body: "Fixed" })
        const edited = cev(commId)
        call("mantle.request.RequestServices.delete#RequestComment", { requestId, communicationEventId: commId })
        const left = ec.entity.find("mantle.request.RequestCommEvent").condition("requestId", requestId).count()
        call("mantle.request.RequestServices.replace#RequestParty", { requestId, roleTypeId: "Assignee", newPartyId: personId })
        const parties = Array.from(ec.entity.find("mantle.request.RequestParty").condition("requestId", requestId).condition("roleTypeId", "Assignee").condition("thruDate", null).list())
        const contentId = call("mantle.request.RequestServices.create#RequestContent", { requestId, requestContentTypeEnumId: "RqctAttachment", description: "file" }).requestContentId
        const contact = call("mantle.request.RequestServices.create#ContactRequest", { requestName: "Contact us", description: "Question", firstName: "Web", lastName: "Visitor", emailAddress: "visitor@example.com" })
        return { request: ec.entity.find("mantle.request.Request").condition("requestId", requestId).one(), comments: comments.length, edited, left, parties, contentId, contact }
    },
    then({ request, comments, edited, left, parties, contentId, contact }) {
        request.requestName == "Support now"
        n(request.priority) == 2
        comments == 1
        edited.subject == "Note 2"
        left == 0
        parties.length == 1
        parties[0].partyId == personId
        contentId != null
        contact.requestId != null
    },
})

feature("duplicate party detection and merge", {
    when() {
        const addr = { address1: "77 Dup Way", city: "Orem", stateProvinceGeoId: "USA_UT", postalCode: "84057", countryGeoId: "USA", postalContactMechPurposeId: "PostalPrimary",
                emailContactMechPurposeId: "EmailPrimary", emailAddress: "dupe." + effectiveTime + "@example.com" }
        const a = call("mantle.party.PartyServices.create#Person", { firstName: "Dupe", lastName: "One" }).partyId
        const b = call("mantle.party.PartyServices.create#Person", { firstName: "Dupe", lastName: "Two" }).partyId
        for (const partyId of [a, b]) call("mantle.party.ContactServices.store#PartyContactInfo", Object.assign({ partyId }, addr))
        const has = call("mantle.party.DuplicateServices.find#PartyHasDuplicates", { partyId: a })
        const dups = call("mantle.party.DuplicateServices.find#PartyDuplicates", { partyId: a })
        const addrs = call("mantle.party.DuplicateServices.find#PostalAddresses", { partyId: a, address1: "77 Dup Way", postalCode: "84057" })
        call("mantle.party.PartyServices.set#PartyClassification", { partyId: b, partyClassificationId: "CustDistributor" })
        call("mantle.party.DuplicateServices.merge#Parties", { toPartyId: a, fromPartyId: b })
        const movedClass = Array.from(ec.entity.find("mantle.party.PartyClassificationAppl").condition("partyId", a).condition("partyClassificationId", "CustDistributor").list()).length
        const fromParty = ec.entity.find("mantle.party.Party").condition("partyId", b).one()
        call("mantle.party.DuplicateServices.check#AllPartyDuplicates", {})
        call("mantle.party.DuplicateServices.merge#AllDuplicateParties", {})
        return { has, dups, addrs, movedClass, fromParty }
    },
    then({ has, dups, addrs, movedClass, fromParty }) {
        has.hasDuplicates == true
        Object.keys(dups.matchingInfoByPartyId).length >= 1
        addrs.postalAddressList.length >= 1
        movedClass == 1
        fromParty == null || fromParty.disabled == "Y" || fromParty.mergedToPartyId != null
    },
})

feature("equipment and maintenance", {
    when() {
        equipmentId = call("mantle.product.EquipmentServices.create#Equipment", { assetName: "Test Press", ownerPartyId: "ORG_ZIZI_RETAIL", productId: "EQUIP_1" }).assetId
        // no MaintenanceType enumerations are seeded
        call("create#moqui.basic.Enumeration", { enumId: "MtTestOil", enumTypeId: "MaintenanceType", description: "Oil change" })
        productMaintenanceId = call("create#mantle.product.maintenance.ProductMaintenance", { productId: "EQUIP_1", maintenanceTypeEnumId: "MtTestOil", description: "Oil change", intervalQuantity: 500 }).productMaintenanceId
        const before = call("mantle.product.EquipmentServices.get#AssetMaintenanceNeeded", { assetId: equipmentId, productMaintenanceId })
        const maint = call("mantle.product.EquipmentServices.create#AssetMaintenance", { assetId: equipmentId, productMaintenanceId, intervalQuantity: 500, comments: "done" })
        const after = call("mantle.product.EquipmentServices.get#AssetMaintenanceNeeded", { assetId: equipmentId, productMaintenanceId })
        return { before, maint, after }
    },
    then({ before, maint, after }) {
        equipmentId != null
        n(before.nextMaintenanceInterval) == 500
        maint.assetMaintenanceId != null
        n(after.nextMaintenanceInterval) == 1000
        after.lastAssetMaintenance != null
    },
})
