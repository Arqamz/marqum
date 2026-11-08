package app.marqum

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PureLogicTest {
    @Test
    fun statementNames() {
        assertTrue(StatementInbox.isStatementName("m-11-2026.pdf"))
        assertTrue(StatementInbox.isStatementName("M-01-2027.CSV"))
        assertTrue(StatementInbox.isStatementName("sadapay_account_statement_01-11-2026_07-11-2026.pdf"))
        assertFalse(StatementInbox.isStatementName("m-1-2026.pdf"))
        assertFalse(StatementInbox.isStatementName("m-11-2026.xlsx"))
        assertFalse(StatementInbox.isStatementName("sadapay_account_statement_x.csv"))
        assertFalse(StatementInbox.isStatementName("photo.jpg"))
    }

    @Test
    fun karachiLocalTime() {
        // 2026-11-07T19:30Z = 2026-11-08T00:30 in Asia/Karachi (UTC+5)
        assertEquals("2026-11-08T00:30", BankNotificationListener.karachiLocal(1_794_079_800_000L))
    }

    @Test
    fun sha256Hex() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            BankNotificationListener.sha256("abc"),
        )
    }
}
