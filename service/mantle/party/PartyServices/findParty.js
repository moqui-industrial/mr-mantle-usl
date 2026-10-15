/*
 * This software is in the public domain under CC0 1.0 Universal plus a 
 * Grant of Patent License.
 * 
 * To the extent possible under law, the author(s) have dedicated all
 * copyright and related and neighboring rights to this software to the
 * public domain worldwide. This software is distributed without any
 * warranty.
 * 
 * You should have received a copy of the CC0 Public Domain Dedication
 * along with this software (see the LICENSE.md file). If not, see
 * <http://creativecommons.org/publicdomain/zero/1.0/>.
 */

// NOTE: a find builder is used up by each call, so each call is assigned back to ef
// NOTE: doing a find with a static view-entity because the Entity Facade will only select the fields specified and the
//     join in the associated member-entities
// don't do distinct, SQL quandary with distinct, limited select, and order by with upper needing to be selected; seems to get good results in general without: .distinct(true)
let ef = ec.entity.find("mantle.party.FindPartyView").distinct(true)

ef = ef.selectField("partyId")

const cf = ec.entity.conditionFactory
const wildcard = leadingWildcard ? "%" : ""
// a LIKE condition on the field with the value and a trailing wildcard, optionally ignoring case
const like = (field, value, ignoreCase = true) =>
        cf.makeActionConditionDirect(field, "like", wildcard + value + "%", null, null, ignoreCase)

if (partyId) ef = ef.condition(like("partyId", partyId))
if (pseudoId) ef = ef.condition(like("pseudoId", pseudoId))
if (partyTypeEnumId) ef = ef.condition("partyTypeEnumId", partyTypeEnumId)
if (disabled) ef = ef.condition("disabled", disabled)
if (customerStatusId) ef = ef.condition("customerStatusId", customerStatusId)
if (hasDuplicates) ef = ef.condition("hasDuplicates", hasDuplicates)
if (roleTypeId) ef = ef.condition("roleTypeId", roleTypeId)
if (username) ef = ef.condition(like("username", username))

if (combinedName) {
    // support splitting by just one space for first/last names
    let fnSplit = combinedName
    let lnSplit = combinedName
    if (combinedName.includes(" ")) {
        fnSplit = combinedName.substring(0, combinedName.indexOf(" "))
        lnSplit = combinedName.substring(combinedName.indexOf(" ") + 1)
    }
    const cnCondList = [like("organizationName", combinedName), like("firstName", fnSplit), like("lastName", lnSplit)]
    ef = ef.condition(cf.makeCondition(cnCondList, "or"))
}

if (organizationName) ef = ef.condition(like("organizationName", organizationName))
if (firstName) ef = ef.condition(like("firstName", firstName))
if (lastName) ef = ef.condition(like("lastName", lastName))
if (suffix) ef = ef.condition(like("suffix", suffix))

if (address1) ef = ef.condition(like("address1", address1))
if (address2) ef = ef.condition(like("address2", address2))
if (city) ef = ef.condition(like("city", city))
if (stateProvinceGeoId) ef = ef.condition("stateProvinceGeoId", stateProvinceGeoId)
if (postalCode) ef = ef.condition(like("postalCode", postalCode))

if (countryCode) ef = ef.condition("countryCode", countryCode)
if (areaCode) ef = ef.condition("areaCode", areaCode)
if (contactNumber) ef = ef.condition(like("contactNumber", contactNumber, false))

if (emailAddress) ef = ef.condition(like("emailAddress", emailAddress))

if (assetSerialNumber) ef = ef.condition(like("assetSerialNumber", assetSerialNumber))

if (orderByField) {
    if (orderByField.includes("combinedName")) {
        if (orderByField.includes("-")) ef = ef.orderBy("-organizationName,-firstName,-lastName")
        else ef = ef.orderBy("organizationName,firstName,lastName")
    } else {
        ef = ef.orderBy(orderByField)
    }
}

// a find runs once, so count with a copy made before the limit and offset are set
const countFind = ef.copy()

const pageIndexInt = Math.trunc(Number(pageIndex))
const pageSizeInt = Math.trunc(Number(pageSize))
if (!pageNoLimit) ef = ef.offset(pageIndexInt * pageSizeInt).limit(pageSizeInt)

partyIdList = []
for (const ev of ef.list()) partyIdList.push(ev.partyId)

partyIdListCount = countFind.count()
// as the find reports them: page 0 of the default size 20 when there is no limit
partyIdListPageIndex = pageNoLimit ? 0 : pageIndexInt
partyIdListPageSize = pageNoLimit ? 20 : pageSizeInt
partyIdListPageMaxIndex = Math.trunc((partyIdListCount - 1) / partyIdListPageSize) + 0
partyIdListPageRangeLow = partyIdListPageIndex * partyIdListPageSize + 1
partyIdListPageRangeHigh = (partyIdListPageIndex * partyIdListPageSize) + partyIdListPageSize
if (partyIdListPageRangeHigh > partyIdListCount) partyIdListPageRangeHigh = partyIdListCount
