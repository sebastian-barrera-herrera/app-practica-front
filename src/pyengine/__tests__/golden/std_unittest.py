import unittest, sys

class T(unittest.TestCase):
    def setUp(self):
        self.x = 5
    def test_ok(self):
        self.assertEqual(self.x, 5)
        self.assertTrue(True)
        self.assertIn(1, [1, 2])
        self.assertAlmostEqual(0.1 + 0.2, 0.3)
        with self.assertRaises(ZeroDivisionError):
            1 / 0
    def test_fail(self):
        self.assertEqual(self.x, 6)
    def test_fail2(self):
        self.assertEqual([1, 2, 3], [1, 2, 4])
    def test_err(self):
        {}["k"]
    @unittest.skip("no")
    def test_skip(self):
        pass
    @unittest.expectedFailure
    def test_xfail(self):
        self.assertTrue(False)
    def test_sub(self):
        for i in range(3):
            with self.subTest(i=i):
                self.assertLess(i, 2)

suite = unittest.defaultTestLoader.loadTestsFromTestCase(T)
r = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
print(r.testsRun, len(r.failures), len(r.errors), len(r.skipped), r.wasSuccessful())
