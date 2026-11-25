import unittest

from ozq.extract import _merge, analyze_page, classify, parse_addresses


def one(text):
    found = parse_addresses(text)
    return [c.one_line for c in found]


class ParseAddresses(unittest.TestCase):
    def test_single_line_with_commas(self):
        self.assertEqual(one("Visit us | 2211 Hamilton Ave, Cleveland, OH 44114 | Open daily"),
                         ["2211 Hamilton Ave, Cleveland, OH 44114"])

    def test_footer_without_commas_and_full_state_name(self):
        self.assertEqual(one("Locate Us | 2516 Market Ave. Cleveland Ohio 44113"),
                         ["2516 Market Ave., Cleveland, OH 44113"])

    def test_multi_line_with_building_name_and_no_suffix(self):
        self.assertEqual(one("Tremont | Address | Tremont Place Lofts | 710 Jefferson Avenue | Cleveland, OH 44113"),
                         ["710 Jefferson Avenue, Cleveland, OH 44113"])
        self.assertEqual(one("Hingetown | Address | 1455 W 29th | Cleveland, OH 44113"),
                         ["1455 W 29th, Cleveland, OH 44113"])

    def test_suite_line_and_zip_plus_four(self):
        self.assertEqual(one("100 Main Street | Suite 400 | Durham, NC 27701-1234"),
                         ["100 Main Street Suite 400, Durham, NC 27701-1234"])

    def test_landmark_phrase_is_dropped(self):
        self.assertEqual(one("2101 Richmond Rd. at LaPlace Beachwood, OH 44122"),
                         ["2101 Richmond Rd., Beachwood, OH 44122"])

    def test_rejects_dates_hours_phones_and_po_boxes(self):
        self.assertEqual(one("September 28, 2017 | Daily, 7am - 6pm | (216) 555-1234 | PO Box 55 | Cleveland, OH 44113"), [])

    def test_lowercase_state_abbreviation_is_not_a_state(self):
        self.assertEqual(one("12 ways in 2024 we grew | Chicago in 60601"), [])


class Pages(unittest.TestCase):
    def test_footer_region_and_dedupe_across_spellings(self):
        html = ("<html><body><main><p>Contact Us</p><p>13015 Larchmere Boulevard</p><p>Shaker Heights, OH 44120</p></main>"
                "<footer><p>13015 Larchmere Blvd.</p><p>Shaker Heights, OH 44120</p></footer></body></html>")
        found, _, _ = analyze_page(html, "https://x.test/contact-us", "contact")
        merged = _merge(found)
        self.assertEqual(len(merged), 1)
        self.assertEqual({s.region for s in merged[0].sources}, {"main", "footer"})
        self.assertAlmostEqual(merged[0].score, 0.90)

    def test_json_ld_postal_address_and_event_venue_ignored(self):
        html = """<html><head>
        <script type="application/ld+json">{"@type":"LocalBusiness","address":{"@type":"PostalAddress",
          "streetAddress":"9500 Euclid Ave","addressLocality":"Cleveland","addressRegion":"OH","postalCode":"44195"}}</script>
        <script type="application/ld+json">{"@type":"Event","location":{"address":{"streetAddress":"1 Other St",
          "addressLocality":"Akron","addressRegion":"OH","postalCode":"44308"}}}</script></head><body></body></html>"""
        found, _, _ = analyze_page(html, "https://x.test/", "home")
        lines = [c.one_line for c, s in found if s.region == "structured"]
        self.assertEqual(lines, ["9500 Euclid Ave, Cleveland, OH 44195"])

    def test_squarespace_business_info_quirk(self):
        html = ('<script type="application/ld+json">{"legalName":"2211 Hamilton Ave",'
                '"address":"Cleveland, OH 44114\\nUSA"}</script>')
        found, _, _ = analyze_page(html, "https://x.test/", "home")
        self.assertEqual([c.one_line for c, _ in found], ["2211 Hamilton Ave, Cleveland, OH 44114"])

    def test_map_link(self):
        html = '<a href="https://www.google.com/maps/place/826+W+St+Clair+Ave,+Cleveland,+OH+44113/@41.5">map</a>'
        found, _, _ = analyze_page(html, "https://x.test/cafes", "locations")
        self.assertEqual([c.one_line for c, s in found if s.region == "map_link"],
                         ["826 W St Clair Ave, Cleveland, OH 44113"])


class Classify(unittest.TestCase):
    def test_page_types(self):
        self.assertEqual(classify("https://x.test/"), "home")
        self.assertEqual(classify("https://x.test/contact-us"), "contact")
        self.assertEqual(classify("https://x.test/how-find-us"), "contact")
        self.assertEqual(classify("https://x.test/locations/"), "locations")
        self.assertEqual(classify("https://x.test/shops", "find a shop"), "locations")
        self.assertEqual(classify("https://x.test/about-us"), "about")
        # product and event pages are not location pages
        self.assertEqual(classify("https://x.test/shop/some-coffee/"), "other")
        self.assertEqual(classify("https://x.test/events/food-drive", "visit"), "other")


if __name__ == "__main__":
    unittest.main()
