# Examplar Assignment Creation:

1. Prepare the wheats, chaffs, and mutants.
    * Given a spec that requires one or more functions, the
      wheat and chaff files are implementation of these
      functions. These files should explicitly provide only the
      functions required by the spec. E.g., if the functions in
      the spec are named `fact` and `fib`, then each of the
      wheat/chaff files should have as header:
      ```
      provide { fact: fact, fib: fib }
      provide-types *
      ```
    * If any tests are provided within these implementations they
      should be commented out

    * **Mutants** are the set of chaffs that represent meaningful student misconceptions. These are used to generate hints in the case that
      a student writes an invalid test. Each mutant comes pairs with a hint, which are displayed to students if they write a corresponding invalid test.

2. Make folders for wheats, chaffs, and mutants that should be included in Examplar,
   note their IDs, and set them (temporarily) to be publicly accessible via link

3. Load the Examplar dummy assignment (https://pyret.cs.brown.edu/assignment/1QIZ_LpROVf4yzWTlfTIJcturEyIs71u_)
   and open the JavaScript console. Note: The following Steps 3-6
   are to be
   done in the JS console, not in the Pyret interaction
   window!

4. Compile the wheats by executing
    ```javascript
    const wheats = compileFiles(<wheat source folder id>)
    ```

5. Click the Run button in the interaction window

6. Compile the chaffs by executing
    ```javascript
    const chaffs = compileFiles(<chaff source folder id>)
    ```
7. Click the Run button in the interaction window

8. Compile the mutants by executing
    ```javascript
    const mutants = compileFiles(<mutant source folder id>)
    ```
9. Click the Run button in the interaction window

10. Make a public subdirectory in the assignment folder with the public facing
   name for the assignment (e.g. 'docdiff') with subdirectories 'wheat', 'chaff', and 'mutant'.

11. After determining the folder IDs for 'wheat' and 'chaff', execute
    ```javascript
    copyCompiled(wheats, <'wheat' folder ID>, chaffs, <'chaff' folder ID>, mutants,  <'mutant' folder ID> )
    ```

12.  Check that the files, which should now have names ending in '.js',
   are present in the 'wheat', 'chaff', and 'mutant' folders

13. Remove link sharing from the wheat and chaff source folders from step 1 (optional)

14. In the folder created in step 7, create the following files:
    * \<assignment>-code.arr
        ```
        provide *
        provide-types *

        include my-gdrive("<assignment>-common.arr")

        # DO NOT CHANGE ANYTHING ABOVE THIS LINE
        #
        # You may write implementation-specific tests (e.g., of helper functions) in this file.

        fun f(x):
            ...
        end

        <other function templates>
        ```

    * \<assignment>-dummy.arr
        ```
        provide *
        provide-types *

        include my-gdrive("<assignment>-common.arr")

        # DO NOT CHANGE ANYTHING ABOVE THIS LINE

        fun f(x):
            raise("Output Hidden")
        end

        <other dummy functions>
        ```

    * \<assignment>-common.arr
        ```
        provide *
        provide-types *

        # DO NOT CHANGE ANYTHING ABOVE THIS LINE
        #
        # Write data bindings here that you'll need for tests in both <assignment>-code.arr and <assignment>-tests.arr
        ```

    * \<assignment>-tests.arr
        ```
        include my-gdrive("<assignment>-code.arr")
        include my-gdrive("<assignment>-common.arr")

        # DO NOT CHANGE ANYTHING ABOVE THIS LINE
        #
        # Write your examples and tests in here. These should not be tests of implementation-specific details (e.g., helper functions).

        check:
            ...
        end
        ```
        If your chaffs/wheats defined and provided `fact` and `fib` as described in Step 0, then your tests will involve comparisons of calls to `fact`/`fib` to their expected values, e.g.,
        ```
        check:
            fact(5) is 120
            fib(11) is 89
        end
        ```


14. Prepare a `hints.json` file for each mutant.  This file should have the following form:
```
{
	"mutant1name": {
		"hint": "hint text",
	},
	"mutant2name": {
		"hint": "hint text",
	},
}
```

Ensure this is well formed JSON, and place this file in the folder from step 9.

15. Access the assignment at https://pyret.cs.brown.edu/assignment/<ID of folder from step 9>
