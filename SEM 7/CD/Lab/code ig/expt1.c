#include <stdio.h>
#include <ctype.h>
#include <string.h>

const char *keywords[] = {
    "int", "float", "if", "else", "while", "for", "return", "char", "double", "void"
};
int numKeywords = 10;

// Check if string is a keyword
int isKeyword(char *str) {
    for (int i = 0; i < numKeywords; i++) {
        if (strcmp(str, keywords[i]) == 0)
            return 1;
    }
    return 0;
}

// Check if character is an operator
int isOperator(char ch) {
    char operators[] = "+-*/=%><!";
    for (int i = 0; operators[i] != '\0'; i++) {
        if (ch == operators[i])
            return 1;
    }
    return 0;
}

// Check if character is a separator
int isSeparator(char ch) {
    char separators[] = "();,{}[]";
    for (int i = 0; separators[i] != '\0'; i++) {
        if (ch == separators[i])
            return 1;
    }
    return 0;
}

int main() {
    FILE *file = fopen("input.txt", "r");
    if (file == NULL) {
        printf("Error: Could not open file.\n");
        return 1;
    }

    char ch;
    int tokenCount = 0;

    while ((ch = fgetc(file)) != EOF) {
        // Skip whitespace
        if (isspace(ch)) continue;

        // Identifiers or Keywords (start with letter or underscore)
        if (isalpha(ch) || ch == '_') {
            char word[50];
            int i = 0;

            while (isalnum(ch) || ch == '_') {
                word[i++] = ch;
                ch = fgetc(file);
            }
            word[i] = '\0';
            ungetc(ch, file); // put back the non-identifier character

            if (isKeyword(word))
                printf("Keyword: %s\n", word);
            else
                printf("Identifier: %s\n", word);

            tokenCount++;
        }

        // Numbers
        else if (isdigit(ch)) {
            printf("Number: ");
            while (isdigit(ch) || ch == '.') {
                printf("%c", ch);
                ch = fgetc(file);
            }
            printf("\n");
            ungetc(ch, file);
            tokenCount++;
        }

        // String literals
        else if (ch == '"') {
            printf("String: \"");
            ch = fgetc(file);
            while (ch != '"' && ch != EOF) {
                printf("%c", ch);
                ch = fgetc(file);
            }
            printf("\"\n");
            tokenCount++;
        }

        // Character literals
        else if (ch == '\'') {
            printf("Character: '");
            ch = fgetc(file);
            while (ch != '\'' && ch != EOF) {
                printf("%c", ch);
                ch = fgetc(file);
            }
            printf("'\n");
            tokenCount++;
        }

        // Operators
        else if (isOperator(ch)) {
            printf("Operator: %c\n", ch);
            tokenCount++;
        }

        // Separators
        else if (isSeparator(ch)) {
            printf("Separator: %c\n", ch);
            tokenCount++;
        }

        // Unknown characters
        else {
            printf("Unknown: %c\n", ch);
            tokenCount++;
        }
    }

    printf("\nTotal Tokens: %d\n", tokenCount);

    fclose(file);
    return 0;
}