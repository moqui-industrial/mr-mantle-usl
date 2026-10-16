// Outgoing bank files: NACHA (mantle.account.NachaServices) and Positive Pay in each supported format
// (PositivePayServices). New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL"
const effectiveTime = Date.now()
let payeeId, companyBankId, payeeBankId, achPaymentIds = [], nachaOut

spec({
    stepwise: true,
    tempSequences: { start: 56500, banks: { "mantle.party.Party": 10, "mantle.account.payment.Payment": 40,
        "mantle.account.method.PaymentMethod": 20, "mantle.account.method.PaymentMethodFile": 10 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}

feature("set up a company bank account with NACHA settings, a payee and ACH payments", {
    when() {
        payeeId = call("mantle.party.PartyServices.create#Person", { firstName: "Pat", lastName: "Payee" }).partyId
        companyBankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId,
                description: "Company ACH", bankName: "Test Bank", routingNumber: "021000021", accountNumber: "5550001234",
                typeEnumId: "BatChecking", currencyUomId: "USD", companyNameOnAccount: "Ziziwork Retail",
                nachaImmedDest: "021000021", nachaImmedOrig: "1234567890", nachaCompanyId: "1234567890",
                nachaEntryDescription: "PAYROLL" }).paymentMethodId
        payeeBankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: payeeId, description: "Payee Checking",
                bankName: "Payee Bank", routingNumber: "011000015", accountNumber: "111222333", typeEnumId: "BatChecking",
                firstNameOnAccount: "Pat", lastNameOnAccount: "Payee" }).paymentMethodId
        for (const amount of ["100.25", "2000.00"]) {
            achPaymentIds.push(call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: payeeId,
                    amount, amountUomId: "USD", paymentMethodId: companyBankId, toPaymentMethodId: payeeBankId,
                    paymentInstrumentEnumId: "PiAch", statusId: "PmntAuthorized", effectiveDate: effectiveTime - 3600000 }).paymentId)
        }
        return { ids: [payeeId, companyBankId, payeeBankId, ...achPaymentIds] }
    },
    then({ ids }) {
        ids.every(id => id != null)
        achPaymentIds.length == 2
    },
})

feature("generate a NACHA file", {
    when() {
        nachaOut = call("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: companyBankId, addNewLine: true, addOffsetRecord: true,
                effectiveEntryDate: "2026-12-15" })
        const lines = nachaOut.fileText.split("\n").filter(l => l.length)
        const file = ec.entity.find("mantle.account.method.PaymentMethodFile").condition("paymentMethodFileId", nachaOut.paymentMethodFileId).one()
        const payments = achPaymentIds.map(id => ec.entity.find("mantle.account.payment.Payment").condition("paymentId", id).one())
        return { lines, file, payments }
    },
    then({ lines, file, payments }) {
        // file header, batch header, two credits, one offset debit, batch control, file control, then 9-filled lines to a
        // multiple of ten records
        lines.length == 10
        lines.every(l => l.length == 94)
        lines[0].startsWith("101")
        lines[1].startsWith("5200")
        lines[2].startsWith("622")
        lines[2].includes("011000015")
        lines[3].startsWith("622")
        lines[4].startsWith("627")
        lines[5].startsWith("8200")
        lines[6].startsWith("9")
        lines.slice(7).every(l => l == "9".repeat(94))
        lines[2].substring(29, 39) == "0000010025"
        lines[3].substring(29, 39) == "0000200000"
        file.fileTypeEnumId == "PmftNacha"
        payments.every(p => p.paymentMethodFileId == nachaOut.paymentMethodFileId)
    },
})

feature("a second NACHA run has nothing to send, and bad configuration is refused", {
    when() {
        const again = call("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: companyBankId })
        const missing = errorOf("mantle.account.NachaServices.generate#NachaFile", { paymentMethodId: "NO_SUCH_METHOD" })
        return { again, missing }
    },
    then({ again, missing }) {
        again.fileText == null
        missing.includes("is not a bank account")
    },
})

const formats = ["PmftBankOfAmericaAr", "PmftCityBankCnb", "PmftSunTrustCpr", "PmftWachoviaAr", "PmftWellsFargoArp", "PmftZionsBankCsv"]
feature("generate Positive Pay files #format", {
    where: formats.map(format => ({ format })),
    when(ctx) {
        const format = ctx.format
        const bankId = call("mantle.account.PaymentMethodServices.create#BankAccount", { ownerPartyId: organizationPartyId,
                description: "PosPay " + format, bankName: "Test Bank", routingNumber: "021000021", accountNumber: "7770001234",
                typeEnumId: "BatChecking", currencyUomId: "USD", posPayFormatEnumId: format, posPayBankNumber: "123" }).paymentMethodId
        for (const [index, amount] of ["150.00", "75.50"].entries()) {
            call("mantle.account.PaymentServices.create#Payment", { fromPartyId: organizationPartyId, toPartyId: payeeId, amount, amountUomId: "USD",
                    paymentMethodId: bankId, paymentRefNum: String(2001 + index), paymentInstrumentEnumId: "PiCompanyCheck",
                    statusId: "PmntDelivered", effectiveDate: effectiveTime - 3600000 })
        }
        const out = call("mantle.account.PositivePayServices.generate#PositivePayFile", { paymentMethodId: bankId })
        const payments = ec.entity.find("mantle.account.payment.Payment").condition("paymentMethodId", bankId).list()
        return { out, payments }
    },
    then({ out, payments }) {
        out.paymentCount == 2
        out.fileText.length > 0
        out.fileText.includes("2001")
        out.fileText.includes("2002")
        payments.every(p => p.paymentMethodFileId == out.paymentMethodFileId)
    },
})

feature("Positive Pay is refused without a format and for unsupported formats", {
    when() {
        const noFormat = errorOf("mantle.account.PositivePayServices.generate#PositivePayFile", { paymentMethodId: companyBankId })
        const notBank = errorOf("mantle.account.PositivePayServices.generate#PositivePayFile", { paymentMethodId: "NO_SUCH_METHOD" })
        return { noFormat, notBank }
    },
    then({ noFormat, notBank }) {
        noFormat.includes("No Pos. Pay File Format")
        notBank.includes("is not a bank account")
    },
})
